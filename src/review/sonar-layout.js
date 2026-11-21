/**
 * Sonar test layout (HU-4730, slice 1 of #4729). Pure: reads the four keys
 * that say what Sonar counts as test or excluded from properties TEXT and
 * matches repo-relative files against them. No file, no git, no dependency.
 */
const KEYS = {
  "sonar.tests": "tests",
  "sonar.test.inclusions": "testInclusions",
  "sonar.test.exclusions": "testExclusions",
  "sonar.exclusions": "exclusions",
};
const NEVER = /$^/;

const emptyLayout = () => ({ tests: [], testInclusions: [], testExclusions: [], exclusions: [] });

// An odd run of backslashes at the end means the last one is not escaped.
function endsWithOddBackslashes(s) {
  let count = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

// Properties logical lines: drop comments, join trailing-backslash continuations.
function logicalLines(text) {
  const out = [];
  let pending = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trimStart();
    if (pending === null && /^[#!]/.test(line)) continue;
    const joined = (pending ?? "") + line;
    if (endsWithOddBackslashes(joined)) { pending = joined.slice(0, -1); continue; }
    pending = null;
    out.push(joined);
  }
  if (pending !== null) out.push(pending);
  return out;
}

const splitList = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function parseSonarLayout(text) {
  const layout = emptyLayout();
  for (const line of logicalLines(text)) {
    const match = /^([^\s=:]+)\s*[=:]\s*(.*)$/.exec(line);
    const field = match && KEYS[match[1]];
    if (field) layout[field] = splitList(match[2]);
  }
  return layout;
}

const escapeLiteral = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

function globSource(glob) {
  let rest = glob.replace(/^(\.\/)+/, "");
  if (rest.endsWith("/")) rest += "**";
  let source = "";
  for (let i = 0; i < rest.length; i++) {
    if (rest.startsWith("**/", i)) { source += "(?:.*/)?"; i += 2; }
    else if (rest.startsWith("**", i)) { source += ".*"; i += 1; }
    else if (rest[i] === "*") source += "[^/]*";
    else if (rest[i] === "?") source += "[^/]";
    else source += escapeLiteral(rest[i]);
  }
  return `^${source}$`;
}

/** Sonar glob to an anchored RegExp; a pattern that cannot compile matches nothing. */
export function globToRegExp(glob) {
  try {
    // Single construction point: every piece of `glob` is regex-escaped or
    // replaced by a fixed fragment in globSource, so no user text is live regex.
    // eslint-disable-next-line security/detect-non-literal-regexp
    return new RegExp(globSource(String(glob)));
  } catch {
    return NEVER;
  }
}

const matchesAny = (patterns, file) => patterns.some((p) => globToRegExp(p).test(file));
const underEntry = (entry, file) =>
  globToRegExp(entry).test(file) || globToRegExp(`${entry.replace(/\/+$/, "")}/`).test(file);

/** "excluded" | "test" | null (null: the caller keeps its own judgement). */
export function classifyBySonar(layout, file) {
  const { tests = [], testInclusions = [], testExclusions = [], exclusions = [] } = layout ?? {};
  if (matchesAny(exclusions, file)) return "excluded";
  if (!tests.some((entry) => underEntry(entry, file))) return null;
  if (testInclusions.length > 0 && !matchesAny(testInclusions, file)) return null;
  return matchesAny(testExclusions, file) ? null : "test";
}
