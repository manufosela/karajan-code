/**
 * What counts toward the PR size budget (KJC-BUG-0205).
 *
 * The budget exists to cap CODE growth. Two implementations of that rule had
 * drifted apart: CI excluded lockfiles, build output and the docs tree, while
 * the local gate summed every line of the diff. A doc-only PR was warned at 234
 * lines locally and counted 104 in CI, and a gate that cries wolf in one place
 * and not the other teaches people to believe neither.
 *
 * Two rules decide what is exempt, and they are not the same rule:
 *  - GENERATED output never counts: nobody wrote it, and the reviewer reads the
 *    source that produced it.
 *  - HUMAN documentation never counts either. Rationing docs is how a project
 *    ends up shipping features nobody can discover (which is exactly what
 *    happened in 4.33.0, see KJC-TSK-0871).
 *
 * And one thing that DOES count, on purpose: AI-rule files (CLAUDE.md,
 * AGENTS.md, templates/**). They enter the agent's context on every run, so
 * unbounded growth there dilutes the signal the agent receives.
 */

// Generated or vendored: nobody typed it. KJC-BUG-0347: also what the review and
// Solomon prompts summarize instead of pasting whole.
const GENERATED = [
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.astro\//,
  /(^|\/)public\/docs\//,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.snap(shot)?$/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/,
  /\.lock$/,
  /(^|\/)tests\/_diet\//,
  // KJC-BUG-0318: the plan `kj plan share` writes, at the project root only.
  /^\.karajan-shared\/plans\/[^/]+\.json$/,
];

const EXEMPT = [
  ...GENERATED,
  // Human documentation, wherever the project keeps it. The landing's docs
  // moved into the monorepo (MONO-3) and the old root-anchored `docs/` rule
  // stopped matching them, which is how documenting started costing budget.
  /(^|\/)docs\/.*\.(md|mdx|txt|rst)$/,
  /^(CHANGELOG|README|CODE_OF_CONDUCT|CONTRIBUTING|SECURITY)(\.[a-z-]+)?\.md$/,
  /^(MIGRATION|TODO).*\.md$/,
];

// The exceptions to the exception: these ARE the agent's context.
const AI_RULES = [/^CLAUDE\.md$/, /^AGENTS\.md$/, /^GEMINI\.md$/, /(^|\/)templates\//];

/** Whether nobody typed this file (lockfile, build output, snapshot...). */
export function isGenerated(file) {
  return Boolean(file) && GENERATED.some((re) => re.test(file));
}

/**
 * @param {string} file
 * @param {Set<string>} [generated] files the repo marks linguist-generated (KJC-BUG-0544)
 * @returns {boolean}
 */
export function countsTowardBudget(file, generated) {
  if (!file) return false;
  // AI-rule files always count: marking them generated does not take them out of the budget.
  if (AI_RULES.some((re) => re.test(file))) return true;
  if (generated?.has(file)) return false;
  return !EXEMPT.some((re) => re.test(file));
}

const toRow = (a, r, from, to) => ({ added: Number(a), removed: Number(r), from, to });

/**
 * KJC-BUG-0504: parse `git diff -M --numstat -z`. A plain entry is
 * added TAB removed TAB path NUL; a rename is added TAB removed TAB NUL old NUL new NUL,
 * so a file literally named "a => b" can never be taken for a move. Output
 * without NUL (plain --numstat lines) has no renames and is read line by line.
 *
 * @param {string} raw
 * @returns {{added: number, removed: number, from: string, to: string}[]} binary counts are NaN
 */
export function parseNumstat(raw) {
  const text = String(raw || "");
  if (!text.includes("\0")) {
    return text.split("\n").filter((l) => l.trim()).map((l) => {
      const [a, r, ...path] = l.split("\t");
      return toRow(a, r, path.join("\t"), path.join("\t"));
    });
  }
  const parts = text.split("\0");
  const rows = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const [a, r, ...rest] = parts[i].split("\t");
    const path = rest.join("\t");
    if (path === "") { rows.push(toRow(a, r, parts[i + 1], parts[i + 2])); i += 2; } else rows.push(toRow(a, r, path, path));
  }
  return rows;
}

/** Lines of a text as git counts them: an empty file has none. */
export function countLines(text) {
  return text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** `git show` spec of a path at the revision the diff was taken against: the index when staged, else the range's head. */
export const showSpec = (range, path) => `${range ? (range.split(/\.{2,3}/)[1] || "HEAD") : ""}:${path}`;

const rowsOf = (numstat) => (Array.isArray(numstat) ? numstat : parseNumstat(numstat)).filter((r) => Number.isFinite(r.added) && Number.isFinite(r.removed));
const entersBudget = (row, generated) => row.from !== row.to && !countsTowardBudget(row.from, generated) && countsTowardBudget(row.to, generated);

/**
 * A pure rename shows 0/0, so a move OUT of an exempt path into a counted one
 * would bring its whole file in for free: its destination is counted whole.
 *
 * @param {string} numstat `git diff -M --numstat -z` output
 * @param {(path: string) => Promise<string>} read the content of a destination path at the diffed revision
 * @returns {Promise<(path: string) => number|undefined>} the `linesOf` the budget functions take
 */
export async function movedLines(numstat, read, generated) {
  const lines = new Map();
  for (const row of rowsOf(numstat).filter((r) => entersBudget(r, generated))) lines.set(row.to, countLines(await read(row.to)));
  return (path) => lines.get(path);
}

function weigh(row, linesOf, generated) {
  if (!countsTowardBudget(row.to, generated)) return { added: 0, net: 0, exempt: row.added };
  if (!entersBudget(row, generated)) return { added: row.added, net: row.added - row.removed, exempt: 0 };
  const lines = linesOf?.(row.to);
  if (lines === undefined) throw new Error(`loc-budget: ${row.from} moved into ${row.to} needs its line count (linesOf)`);
  return { added: lines, net: lines, exempt: 0 };
}

/**
 * KJC-BUG-0208 — the policy invariant `net_lines_added` summed the whole
 * numstat, so the same diff printed 174 in the size gate and 202 in the policy,
 * two lines apart. One rule, one number: the metric is netted over the files
 * that count, and what does not count is still said out loud.
 *
 * @param {string} numstat output of `git diff -M --numstat -z`
 * @param {(path: string) => number|undefined} [linesOf] see movedLines
 * @returns {{net: number, exempt: number}}
 */
export function budgetedNet(numstat, linesOf, generated) {
  let net = 0;
  let exempt = 0;
  for (const row of rowsOf(numstat)) {
    const w = weigh(row, linesOf, generated);
    net += w.net;
    exempt += w.exempt;
  }
  return { net, exempt };
}

/**
 * @param {string} numstat output of `git diff -M --numstat -z`
 * @param {(path: string) => number|undefined} [linesOf] see movedLines
 * @returns {{added: number, exempt: number, testAdded: number}}
 */
export function budgetedAdded(numstat, linesOf, generated) {
  let added = 0;
  let exempt = 0;
  let testAdded = 0;
  for (const row of rowsOf(numstat)) {
    const w = weigh(row, linesOf, generated);
    added += w.added;
    exempt += w.exempt;
    if (w.added && /\/tests?\/|__tests__\/|\.test\.|\.spec\./.test(`/${row.to}`)) testAdded += w.added;
  }
  return { added, exempt, testAdded };
}
