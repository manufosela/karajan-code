/**
 * HU-3840 — what a project's test runner configs leave out of collection, read entry
 * by entry from their AST (`src/.claude-fixtures/**` does not cover `.claude/worktrees`).
 * vitest: `test.exclude` globs as tinyglobby reads them (posix, dot files, a matching
 * folder is skipped whole); jest: its ignore patterns, regexes on the absolute path.
 */
import fs from "node:fs";
import path from "node:path";
import { parse, parseExpression } from "@babel/parser";
import { plugins, walk } from "../audit/member-reachability.js";

// Agent worktree folders (grebla: ~500 extra files hung the pre-push); vitest's default exclude misses them.
const AGENT_WORKTREE_DIRS = [".claude/worktrees", ".kj/worktrees"];
// A lane name no real pattern targets: only a pattern that covers EVERY lane can match it.
const SAMPLE_LANE = "kj-steward-sample-lane";
const EXTS = ["js", "ts", "mjs", "mts", "cjs", "cts"];
const CONFIGS = [
  ...["vitest.config", "vite.config"].flatMap((base) => EXTS.map((ext) => ({ name: `${base}.${ext}`, runner: "vitest" }))),
  ...[...EXTS, "json"].map((ext) => ({ name: `jest.config.${ext}`, runner: "jest" })),
  { name: "package.json", runner: "jest", key: "jest" },
];
const JEST_KEYS = new Set(["testPathIgnorePatterns", "modulePathIgnorePatterns"]);
const keyOf = (prop) => prop.key?.name ?? prop.key?.value;
/** The literal strings of an array; spreads and computed entries cannot be read. */
const strings = (node) => (node?.type === "ArrayExpression" ? node.elements : []).flatMap((e) => {
  if (e?.type === "StringLiteral") return [e.value];
  return e?.type === "TemplateLiteral" && e.expressions.length === 0 ? [e.quasis[0].value.cooked] : [];
});
/** vitest: the `exclude` of each `test` block (never coverage.exclude); jest: its ignore patterns. */
function patternsOf(ast, runner) {
  const found = { testBlock: false, patterns: [] };
  walk(ast, (node) => {
    if (node.type !== "ObjectProperty") return;
    if (runner === "jest" && JEST_KEYS.has(keyOf(node))) found.patterns.push(...strings(node.value));
    if (runner !== "vitest" || keyOf(node) !== "test" || node.value?.type !== "ObjectExpression") return;
    found.testBlock = true;
    found.patterns.push(...node.value.properties.filter((p) => keyOf(p) === "exclude").flatMap((p) => strings(p.value)));
  });
  return found;
}
const GLOB_TOKEN = /\*\*\/|\/\*\*$|\*\*|\*|\?|\{[^{}]*\}|\[[^\]]*\]|[.+^$()|\\[\]{}]/g;
/** A glob as regex source, picomatch-style with dot files on: inside braces `**` is a plain star. */
function globSource(glob) {
  return glob.replace(GLOB_TOKEN, (t) => {
    if (t === "**/") return "(?:.*/)?";
    if (t === "/**") return "(?:/.*)?";
    if (t === "**") return ".*";
    if (t === "*") return "[^/]*";
    if (t === "?") return "[^/]";
    if (t[0] === "{" && t.length > 1) return `(?:${t.slice(1, -1).split(",").map((alt) => globSource(alt.replaceAll("**", "*"))).join("|")})`;
    if (t[0] === "[" && t.length > 1) return t.replace(/^\[!/, "[^");
    return `\\${t}`;
  });
}
// A pattern that does not compile covers nothing: the verdict errs towards broken, never towards ok.
const compile = (source) => { try { return new RegExp(source); } catch { return null; } };
/** The folder, its parents and one lane inside it: a glob matching any of them skips the agent tree. */
const dirsOf = (folder) => [...folder.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/")), `${folder}/${SAMPLE_LANE}`];
function coverOf(runner, patterns, projectDir) {
  if (runner === "jest") {
    // The project's own patterns, compiled the way jest does, tried on one short path.
    const res = patterns.map((p) => compile(p.replaceAll("<rootDir>", projectDir))).filter(Boolean);
    return (folder) => res.some((re) => re.test(`${projectDir}/${folder}/${SAMPLE_LANE}/`));
  }
  // tinyglobby drops negated ignores and a trailing slash, and normalizes `./`.
  const globs = patterns.filter((g) => g && !g.startsWith("!")).map((g) => compile(`^${globSource(path.posix.normalize(g.replace(/\/+$/, "")))}$`)).filter(Boolean);
  return (folder) => dirsOf(folder).some((dir) => globs.some((re) => re.test(dir)));
}
const parseFile = (name, text) => (name.endsWith(".json") ? parseExpression(text) : parse(text, { sourceType: "unambiguous", plugins: plugins(name) }));
/** One runner config: its cover test, why it could not be read, or null when absent or not a test config. */
function configAt(projectDir, { name, runner, key }) {
  const file = path.join(projectDir, name);
  if (!fs.existsSync(file)) return null;
  let ast;
  try { ast = parseFile(name, fs.readFileSync(file, "utf8")); } catch (err) { return { name, reason: `${name} could not be parsed (${err.message})` }; }
  if (key) ast = ast.properties?.find((p) => keyOf(p) === key)?.value;
  const { testBlock, patterns } = patternsOf(ast, runner);
  if (!ast || (name.startsWith("vite.config") && !testBlock)) return null;
  return { name: key ? `${name} (${key})` : name, covers: coverOf(runner, patterns, projectDir) };
}
/**
 * @param {string} projectDir
 * @returns {{folders: string[], configs: Array<{name: string, leaks?: string[], reason?: string}>}}
 */
export function sweepRunnerExcludes(projectDir) {
  const folders = AGENT_WORKTREE_DIRS.filter((dir) => fs.existsSync(path.join(projectDir, dir)));
  if (folders.length === 0) return { folders, configs: [] };
  const configs = CONFIGS.map((c) => configAt(projectDir, c)).filter(Boolean)
    .map((c) => (c.reason ? c : { name: c.name, leaks: folders.filter((f) => !c.covers(f)) }));
  return { folders, configs };
}
