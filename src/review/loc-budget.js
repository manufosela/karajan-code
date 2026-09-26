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

const EXEMPT = [
  // Generated or vendored: nobody typed it.
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
  // Human documentation, wherever the project keeps it. The landing's docs
  // moved into the monorepo (MONO-3) and the old root-anchored `docs/` rule
  // stopped matching them, which is how documenting started costing budget.
  /(^|\/)docs\/.*\.(md|mdx|txt|rst)$/,
  /^(CHANGELOG|README|CODE_OF_CONDUCT|CONTRIBUTING|SECURITY)(\.[a-z-]+)?\.md$/,
  /^(MIGRATION|TODO).*\.md$/,
];

// The exceptions to the exception: these ARE the agent's context.
const AI_RULES = [/^CLAUDE\.md$/, /^AGENTS\.md$/, /^GEMINI\.md$/, /(^|\/)templates\//];

/** @param {string} file @returns {boolean} */
export function countsTowardBudget(file) {
  if (!file) return false;
  if (AI_RULES.some((re) => re.test(file))) return true;
  return !EXEMPT.some((re) => re.test(file));
}

/**
 * @param {string} numstat output of `git diff --numstat`
 * @returns {{added: number, exempt: number, testAdded: number}}
 */
export function budgetedAdded(numstat) {
  let added = 0;
  let exempt = 0;
  let testAdded = 0;
  for (const line of String(numstat || "").split("\n")) {
    if (!line.trim()) continue;
    const [a, , ...rest] = line.split("\t");
    const n = Number(a);
    if (!Number.isFinite(n)) continue; // binary files emit '-'
    const file = rest.join("\t");
    if (!countsTowardBudget(file)) { exempt += n; continue; }
    added += n;
    if (/\/tests?\/|__tests__\/|\.test\.|\.spec\./.test(`/${file}`)) testAdded += n;
  }
  return { added, exempt, testAdded };
}
