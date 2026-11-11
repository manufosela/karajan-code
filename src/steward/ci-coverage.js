/**
 * Does any CI workflow run the tests with coverage? (KJC-TSK-1518, #3604)
 * A threshold nobody applies protects nothing. Plain line scan of `run:`
 * steps, no YAML library; npm script indirection is followed one level.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { plugins } from "../audit/member-reachability.js";
const DIRECT_COVERAGE_RE = /--coverage\b|(?:^|[\s;&|])(?:c8|nyc)(?:\s|$)/;
const SCRIPT_CALL_RE = /\b(?:npm\s+run(?:-script)?|pnpm(?:\s+run)?|yarn(?:\s+run)?|npm)\s+([\w:.-]+)/g;
const RUN_LINE_RE = /^(\s*)(?:-\s+)?run:\s*(.*)$/;
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*$/;
const indentOf = (line) => line.length - line.trimStart().length;
/** The `run:` commands of one workflow: inline values and `run: |` blocks. */
export function runCommands(text) {
  const lines = text.split(/\r?\n/);
  const commands = [];
  let i = 0;
  while (i < lines.length) {
    const match = RUN_LINE_RE.exec(lines[i]);
    const value = match ? match[2].trim() : null;
    if (value !== null && !BLOCK_SCALAR_RE.test(value)) commands.push(value);
    let next = i + 1;
    if (value !== null && BLOCK_SCALAR_RE.test(value)) {
      // A `run: |` block: the following lines indented deeper than `run:` (blank lines included).
      const base = indentOf(lines[i]);
      while (next < lines.length && (lines[next].trim() === "" || indentOf(lines[next]) > base)) next += 1;
      commands.push(...lines.slice(i + 1, next).map((l) => l.trim()).filter(Boolean));
    }
    i = next;
  }
  return commands;
}
function readScripts(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")).scripts ?? {}; } catch { return {}; }
}
// With coverage on by default in the runner config, any test run applies the threshold.
const TEST_RUN_RE = /(?:^|[\s;&|/])(?:vitest|jest)(?:\s|$)/;
/** The runner config turns coverage on by itself (vitest `coverage: { enabled: true }`, jest `collectCoverage: true`). */
const keyOf = (p) => p.key?.name ?? p.key?.value;
const isTrue = (node) => node?.type === "BooleanLiteral" && node.value === true;
function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}
/**
 * The runner config turns coverage on by itself: vitest `coverage: { enabled: true }` (read from
 * the parsed config, so quotes, order and strings do not fool it) or jest `collectCoverage: true`.
 * A config that does not parse is not read as on.
 */
export function coverageOnByDefault(configText, file = "vitest.config.js") {
  if (/\bcollectCoverage["']?\s*:\s*true\b/.test(configText)) return true;
  let tree;
  try { tree = parse(configText, { sourceType: "unambiguous", plugins: plugins(file) }); } catch { return false; }
  let on = false;
  walk(tree.program, (n) => {
    if (n.type !== "ObjectProperty" || keyOf(n) !== "coverage" || n.value?.type !== "ObjectExpression") return;
    if (n.value.properties.some((p) => keyOf(p) === "enabled" && isTrue(p.value))) on = true;
  });
  return on;
}
export function commandRunsCoverage(command, scripts = {}, { alwaysOn = false } = {}) {
  const matches = (text) => DIRECT_COVERAGE_RE.test(text) || (alwaysOn && TEST_RUN_RE.test(text));
  if (matches(command)) return true;
  return [...command.matchAll(SCRIPT_CALL_RE)].some((m) => matches(String(scripts[m[1]] ?? "")));
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
