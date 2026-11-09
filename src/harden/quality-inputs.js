/**
 * quality-inputs — what the Quality workflow assumes about the repo
 * (KJC-BUG-0529, issue #3661): the Node version, the test script and the PHP version.
 * Decided here from the files; the template only renders what it is given.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VERSION_LITERAL = /^[0-9][0-9.x]*$/;
const NODE_VERSION_LINE = /^\s*node-version:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/gm;

function readJsonFile(dir, name) {
  try {
    return JSON.parse(readFileSync(join(dir, name), "utf8"));
  } catch {
    return null;
  }
}

const readPackageJson = (dir) => readJsonFile(dir, "package.json");

// node-version values the repo's own workflows use, kj's managed ones skipped.
function workflowVersions(projectDir) {
  const dir = join(projectDir, ".github", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !f.startsWith("kj-"))
    .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(NODE_VERSION_LINE)].map((m) => m[1]));
}

/** `{ file }` | `{ version }` for setup-node, or null when nothing usable is found. */
export function detectNodeVersion({ projectDir, appDir, root = "." }) {
  const prefix = root === "." || root === "" ? "" : `${root}/`;
  const pkg = readPackageJson(appDir);
  const file = [".nvmrc", ".node-version"].find((name) => existsSync(join(appDir, name)))
    ?? (pkg?.engines?.node ? "package.json" : null);
  if (file) return { file: `${prefix}${file}` };
  const found = new Set(workflowVersions(projectDir));
  const [only] = found;
  return found.size === 1 && VERSION_LITERAL.test(only) ? { version: only } : null;
}

/** "test" | "test:unit" | null, from the scripts of package.json. */
export function detectTestScript(appDir) {
  const pkg = readPackageJson(appDir);
  if (!pkg) return "test"; // no package.json yet (fresh repo): today's behavior
  const scripts = pkg.scripts;
  return ["test", "test:unit"].find((name) => scripts?.[name]) ?? null;
}

// KJC-BUG-0529 (#3661, part 2): the PHP version the PHP Quality workflow installs.
const PHP_VERSION = /^\d+\.\d+$/;
// Composer's OR: `||`, and the legacy single `|` it still accepts.
const OR_SEPARATOR = /\|\|?/;
// A term that sets a minimum: `^8.4`, `~8.4`, `>=8.4`, `>8.4`, `8.4`, `8.4.*`, `^8.4.1` → [8, 4]; `^8` → [8, 0].
// Read in two steps, each under Sonar's regex complexity limit: the operator it may start with, then its version.
const MINIMUM_OPERATOR = /^(?:\^|~|>=?|==?)/;
const MINIMUM_VERSION = /^(\d+)(?:\.(\d+))?(?:\.(?:\d+|\*))?$/;
// A term that only caps or excludes (`<9.0`, `<=8.4`, `!=8.3.1`, `<>8.3.1`): it never sets the minimum.
const CAP_OR_EXCLUSION = /^(?:<>|<=?|!=)/;

const comparePhp = ([aMajor, aMinor], [bMajor, bMinor]) => aMajor - bMajor || aMinor - bMinor;

/** The AND terms of one alternative: `>=8.4 <9.0`, `>=8.4,<9.0`, `>= 8.4`; a hyphen range keeps its lower end. */
function termsOf(alternative) {
  const tokens = alternative.replaceAll(/([<>=!^~])\s+/g, "$1").split(/[\s,]+/).filter(Boolean);
  // `8.1 - 8.4` → `8.1`: the upper end of a hyphen range never sets the minimum.
  return tokens.filter((token, i) => token !== "-" && tokens[i - 1] !== "-");
}

/** `[major, minor]` of a term that sets a minimum, or null when it cannot be read. */
function lowerBoundOf(term) {
  const match = MINIMUM_VERSION.exec(term.replace(MINIMUM_OPERATOR, ""));
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : null;
}

/** The lowest `[major, minor]` one alternative allows (its highest lower bound), or null when it cannot tell. */
function lowestOfAlternative(alternative) {
  const bounds = termsOf(alternative).filter((term) => !CAP_OR_EXCLUSION.test(term)).map(lowerBoundOf);
  if (bounds.length === 0 || bounds.includes(null)) return null;
  return bounds.toSorted(comparePhp).at(-1);
}

/** "8.4" for the lowest PHP version composer.json `require.php` allows, or null when no minimum can be read. */
export function detectPhpVersion(appDir) {
  const constraint = readJsonFile(appDir, "composer.json")?.require?.php;
  if (typeof constraint !== "string") return null;
  const lowest = constraint.split(OR_SEPARATOR).map(lowestOfAlternative);
  if (lowest.includes(null)) return null;
  const version = lowest.toSorted(comparePhp)[0].join(".");
  return PHP_VERSION.test(version) ? version : null;
}

/** The PHP inputs for qualityWorkflowFor's options, plus the note when kj falls back to 8.3. */
export function phpInputs({ appDir }) {
  const phpVersion = detectPhpVersion(appDir);
  const note = phpVersion ? "" : "kj-quality: no minimum PHP version in composer.json require.php; using 8.3";
  return { options: { phpVersion }, note };
}

/** The inputs for qualityWorkflowFor's options plus the notes naming what kj assumed. */
export function qualityInputs({ projectDir, appDir, root }) {
  const nodeVersion = detectNodeVersion({ projectDir, appDir, root });
  const testScript = detectTestScript(appDir);
  const notes = [];
  if (!nodeVersion) notes.push("kj-quality: no Node version found in .nvmrc, .node-version, engines or your workflows; using 22");
  if (!testScript) notes.push("kj-quality: no test or test:unit script; the workflow runs no tests");
  return { options: { nodeVersion, testScript }, note: notes.join("; ") };
}
