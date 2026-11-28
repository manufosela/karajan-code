// HU-5049 (KJC-BUG-0688): which test files of a package are Playwright's. The config is read as
// text, never executed.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CONFIGS = ["ts", "js", "mjs", "cjs"].map((ext) => `playwright.config.${ext}`);
const DEFAULT_MATCH = "**/*.@(spec|test).?(c|m)[jt]s?(x)";
const FALLBACK = /(^|\/)e2e\/|\.e2e\./;
const STRING = String.raw`'[^'\n]*'|"[^"\n]*"|\x60[^\x60$\n]*\x60`;
const REGEX = String.raw`\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\[\n])+\/[imsu]*`;
const ITEM = `(?:${STRING}|${REGEX})`;
const VALUE = new RegExp(String.raw`^\s*:\s*(${ITEM}|\[\s*(?:${ITEM}\s*,?\s*)+\])\s*(?=[,}\n]|$)`);

function literal(source) {
  if (!source.startsWith("/")) return source.slice(1, -1);
  const end = source.lastIndexOf("/");
  return new RegExp(source.slice(1, end), source.slice(end + 1));
}

/** The key's literal values, [] when absent, null when not one plain top-level literal. */
function readKey(text, key) {
  const [before, ...after] = text.split(new RegExp(String.raw`\b${key}\b`));
  if (after.length === 0) return [];
  if (after.length > 1 || /\bprojects\s*:/.test(before)) return null;
  const value = VALUE.exec(after[0])?.[1];
  return value ? value.match(new RegExp(ITEM, "g")).map(literal) : null;
}

function parseConfig(text) {
  const dirs = readKey(text, "testDir");
  const matches = readKey(text, "testMatch");
  if (!dirs || !matches || dirs.some((dir) => typeof dir !== "string")) return null;
  return { testDir: dirs[0] ?? ".", testMatch: matches.length > 0 ? matches : [DEFAULT_MATCH] };
}

function matches(pattern, dir, file) {
  if (pattern instanceof RegExp) return pattern.test(path.join(dir, file));
  // Relative to the package: a "**" glob does not cross the dot dirs of an absolute path.
  return path.posix.matchesGlob(file, pattern.startsWith("**/") ? pattern : `**/${pattern}`);
}

function dependsOnPlaywright(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Boolean(deps["@playwright/test"] ?? deps.playwright);
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

/** The files testDir and testMatch select; e2e/ and *.e2e.* when those cannot be read. */
function selector(dir, text) {
  const config = parseConfig(text);
  if (!config) return dependsOnPlaywright(dir) ? (file) => FALLBACK.test(file) : () => false;
  const testDir = path.resolve(dir, config.testDir);
  return (file) => !path.relative(testDir, path.join(dir, file)).startsWith("..")
    && config.testMatch.some((pattern) => matches(pattern, dir, file));
}

/** True for each package-relative file that Playwright, not the unit runner, owns. */
export function playwrightMatcher(dir) {
  const name = CONFIGS.find((candidate) => existsSync(path.join(dir, candidate)));
  if (!name) return () => false;
  // Only comments that start a line: globs hold "/*" and "//" inside their strings.
  const text = readFileSync(path.join(dir, name), "utf8").replaceAll(/^\s*(\/\/.*|\/\*[\s\S]*?\*\/)/gm, "");
  const ignored = readKey(text, "testIgnore");
  // An unreadable testIgnore may exclude any file: skipping one could hide a red unit test.
  if (!ignored) return () => false;
  const selected = selector(dir, text);
  return (file) => selected(file) && !ignored.some((pattern) => matches(pattern, dir, file));
}
