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
  const file = [".nvmrc", ".node-version"].find((name) => existsSync(join(appDir, name)));
  if (file) return { file: `${prefix}${file}` };
  // KJC-BUG-0533 (#3679): engines.node is a range, and setup-node would install the newest Node it allows,
  // whose npm may reject the repo's lockfile. Its lowest major is the one the repo surely supports.
  const enginesMajor = lowestNodeMajor(pkg?.engines?.node);
  if (enginesMajor) return { version: enginesMajor };
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

// KJC-BUG-0533: an engines.node alternative open from a minimum, where every release of its major qualifies:
// `>=22`, `>=22.5`, `^20.11.0`, `22`, `22.x`, `~22`. A bare `20.11.0` pins one release and `~20.11` bounds
// the minor, so they are not, and neither is major 0, where a caret bounds the minor (`^0.5.0` means `<0.6.0`).
const OPEN_FROM_MAJOR = /^(?:(?:>=|\^)([1-9]\d*)(?:\.\d+){0,2}|~?([1-9]\d*)(?:\.[xX*]){0,2})$/;
// The only cap allowed beside it: one that ends at a later major (`<23`, `<23.0.0`).
const NEXT_MAJOR_CAP = /^<(\d+)(?:\.0){0,2}$/;

/** The major of one alternative, or null when its range bounds the minor or patch (`>=20.11.0 <20.12.0`, `~20.11`). */
function majorOfAlternative(alternative) {
  // Every token kept, a hyphen range's upper end too (`20 - 20.5`), unlike PHP's termsOf.
  const tokens = alternative.replaceAll(/([<>=^~])\s+/g, "$1").split(/[\s,]+/).filter(Boolean);
  const [minimum = "", cap, ...rest] = tokens;
  const match = OPEN_FROM_MAJOR.exec(minimum);
  if (!match || rest.length > 0) return null;
  const major = Number(match[1] ?? match[2]);
  if (cap === undefined) return major;
  const capMajor = NEXT_MAJOR_CAP.exec(cap)?.[1];
  return capMajor && Number(capMajor) > major ? major : null;
}

/** "22" for the lowest Node major engines.node allows, or null when the range is not open across a whole major. */
function lowestNodeMajor(range) {
  if (typeof range !== "string") return null;
  const majors = range.split(OR_SEPARATOR).map(majorOfAlternative);
  return majors.includes(null) ? null : String(Math.min(...majors));
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
