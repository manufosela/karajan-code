/**
 * Does any CI workflow run the tests with coverage? (KJC-TSK-1518, #3604)
 * A threshold nobody applies protects nothing. The `run:` steps are read with
 * the YAML parser; package scripts are followed two levels.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { parse as parseYaml } from "yaml";
import { plugins } from "../audit/member-reachability.js";
const COVERAGE_WRAPPERS = new Set(["c8", "nyc"]);
// `--coverage`, `--coverage=true`, `--coverage.enabled`; an explicit false or 0 turns it off.
const COVERAGE_FLAG_RE = /--coverage(?:\.enabled)?(?:=(\S+))?(?=\s|$)/g;
const OFF = new Set(["false", "0"]);
const RUNNERS = new Set(["vitest", "jest"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const TEST_ALIASES = new Set(["test", "t"]);
const segmentsOf = (text) => text.split(/&&|\|\||[;|]/);
/** The package script a segment runs (`npm run x`, `npm test`), or null when it runs none. */
function scriptNameOf(rest) {
  if (rest[0] === "run" || rest[0] === "run-script") return rest[1] && !rest[1].startsWith("-") ? rest[1] : null;
  return TEST_ALIASES.has(rest[0]) ? "test" : null;
}
/** [program, ...args] of a shell segment, past env assignments, `npx` and `<pm> exec|dlx [--]`. */
function wordsOf(segment) {
  const words = segment.trim().split(/\s+/).filter((w) => w && !/^\w+=/.test(w));
  let skip = 0;
  if (words[0] === "npx") skip = 1;
  else if (PACKAGE_MANAGERS.has(words[0]) && ["exec", "dlx"].includes(words[1])) skip = 2;
  return words.slice(words[skip] === "--" ? skip + 1 : skip);
}
const isRunner = (program, rest) => RUNNERS.has(program) || (program === "node" && rest.includes("--test"));
// The last coverage flag of the segment decides, as the runners read them (`--coverage --coverage=false`
// is off): true, false, or undefined when the segment sets none.
const coverageFlag = (segment) => {
  const last = [...segment.matchAll(COVERAGE_FLAG_RE)].at(-1);
  return last ? !OFF.has(String(last[1] ?? "").toLowerCase()) : undefined;
};
const MAX_SCRIPT_DEPTH = 3; // package scripts followed this deep, so a loop cannot hang
/**
 * Whether one shell segment runs the tests with coverage: a runner by its last coverage flag (one
 * forwarded by `npm test -- --coverage=false` wins), else coverage on by default; c8 / nyc wrapping a
 * test run; a package script followed through package.json. `echo --coverage` never counts.
 */
function segmentCoverage(segment, ctx, depth = 0, forwarded = undefined) {
  const [program, ...rest] = wordsOf(segment);
  const flag = forwarded ?? coverageFlag(segment);
  if (COVERAGE_WRAPPERS.has(program)) {
    const wrapped = rest.slice(rest.findIndex((w) => !w.startsWith("-")));
    return wrapped.length > 0 && segmentCoverage(wrapped.join(" "), { ...ctx, alwaysOn: true }, depth, true);
  }
  if (isRunner(program, rest)) return flag ?? ctx.alwaysOn;
  if (!PACKAGE_MANAGERS.has(program) || depth >= MAX_SCRIPT_DEPTH) return false;
  const script = ctx.scripts[scriptNameOf(rest)];
  return typeof script === "string" && segmentsOf(script).some((s) => segmentCoverage(s, ctx, depth + 1, flag));
}
/** The `run:` commands of one workflow, one per line, read with the YAML parser (quotes and blocks included). */
export function runCommands(text) {
  let doc;
  try { doc = parseYaml(text); } catch { return []; } // an unparsable workflow runs nothing kj can see
  const steps = Object.values(doc?.jobs ?? {}).flatMap((job) => (Array.isArray(job?.steps) ? job.steps : []));
  return steps.flatMap((s) => (typeof s?.run === "string" ? s.run.split("\n") : [])).map((l) => l.trim()).filter(Boolean);
}
function readScripts(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")).scripts ?? {}; } catch { return {}; }
}
const keyOf = (p) => p.key?.name ?? p.key?.value;
const isTrue = (node) => node?.type === "BooleanLiteral" && node.value === true;
function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const child of Object.values(node)) (Array.isArray(child) ? child : [child]).forEach((c) => walk(c, visit));
}
/**
 * The runner config turns coverage on by itself: vitest `coverage: { enabled: true }` (read from
 * the parsed config, so quotes, order and strings do not fool it) or jest `collectCoverage: true`.
 * A config that does not parse is not read as on.
 */
export function coverageOnByDefault(configText, file = "vitest.config.js") {
  // A JSON config (jest.config.json, package.json) parses as an expression.
  const source = file.endsWith(".json") ? `(${configText})` : configText;
  let tree;
  try { tree = parse(source, { sourceType: "unambiguous", plugins: plugins(file) }); } catch { return false; }
  let on = false;
  walk(tree.program, (n) => {
    if (n.type !== "ObjectProperty") return;
    if (keyOf(n) === "collectCoverage" && isTrue(n.value)) on = true;
    if (keyOf(n) === "coverage" && n.value?.type === "ObjectExpression"
      && n.value.properties.some((p) => keyOf(p) === "enabled" && isTrue(p.value))) on = true;
  });
  return on;
}
/** `alwaysOn`: the runner config turns coverage on by itself, so any test run applies the threshold. */
export function commandRunsCoverage(command, scripts = {}, { alwaysOn = false } = {}) {
  return segmentsOf(command).some((s) => segmentCoverage(s, { scripts, alwaysOn }));
}
/** @returns {{workflows: string[], covering: string[]}} workflow file names found / running coverage. */
export function ciCoverageWorkflows(projectDir, { alwaysOn = false } = {}) {
  const dir = path.join(projectDir, ".github", "workflows");
  let names;
  try { names = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort(); } catch { return { workflows: [], covering: [] }; }
  const scripts = readScripts(projectDir);
  const runs = (name) => runCommands(fs.readFileSync(path.join(dir, name), "utf8"));
  const covering = names.filter((name) => runs(name).some((c) => commandRunsCoverage(c, scripts, { alwaysOn })));
  return { workflows: names, covering };
}
