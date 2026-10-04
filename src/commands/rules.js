/**
 * kj rules eval (KJC-TSK-0943, MDR-B2, ADR 0016): the hook's contract, the same
 * as `kj policy eval --strict`. One tool call in, a JSON verdict out, exit
 * 0 = allow, 2 = deny, 1 = it could not be evaluated (invalid or unreadable
 * rules.yml, unreadable input).
 */
import fs from "node:fs";
import path from "node:path";

import { isObject, parseRules } from "../rules/compiled.js";
import { coverage, NO_GATE } from "../rules/coverage.js";
import { evalRules } from "../rules/evaluate.js";
import { listRules } from "../rules/inventory.js";

export const RULES_FILE = path.join(".karajan", "rules.yml");

/**
 * The compiled rules of a project. A file that does not exist is no rules; a
 * file that exists and cannot be read is an error (rules silently off would be
 * every call allowed).
 */
export function loadRules(projectDir, file = RULES_FILE) {
  let text;
  try {
    text = fs.readFileSync(path.resolve(projectDir, file), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { present: false, rules: [], errors: [] };
    return { present: true, rules: [], errors: [`cannot read ${file}: ${err.code || err.message}`] };
  }
  return { present: true, ...parseRules(text) };
}

const failed = (...errors) => ({ code: 1, output: { errors } });

/**
 * KJC-TSK-0946: `--input -` reads the tool input from stdin. The hook passes it
 * that way, because a large Write does not fit in one argument. Read as a
 * stream: a synchronous read of a pipe fails (EAGAIN) once the input is large.
 */
export async function readToolInput(flag, stdin = process.stdin) {
  if (flag !== "-") return flag;
  let text = "";
  for await (const chunk of stdin) text += chunk;
  return text;
}

/** @returns {{code: 0|1|2, output: object}} */
export function rulesEval({ projectDir, tool, input = "{}" }) {
  if (typeof tool !== "string" || !tool) return failed("--tool is required");
  let args;
  try { args = JSON.parse(input); } catch { return failed("--input must be valid JSON"); }
  if (!isObject(args)) return failed("--input must be a JSON object (the tool input)");
  const { rules, errors } = loadRules(projectDir);
  if (errors.length) return failed(...errors);
  const output = evalRules(rules, { tool, input: args });
  return { code: output.decision === "deny" ? 2 : 0, output };
}

const isCall = (c) => isObject(c) && typeof c.tool === "string" && c.tool !== "" && (c.input === undefined || isObject(c.input));
const isCallList = (list) => Array.isArray(list) && list.length > 0 && list.every(isCall);

/** What a rule's examples say against the rule itself, alone. */
function exampleFailures(rule) {
  const { deny, allow } = isObject(rule.examples) ? rule.examples : {};
  if (!isCallList(deny) || !isCallList(allow)) return [`${rule.id}: needs examples.deny and examples.allow, each a list of { tool, input } calls`];
  const verdict = (call) => evalRules([rule], call).decision;
  return [
    ...deny.flatMap((call, i) => (verdict(call) === "deny" ? [] : [`${rule.id}: deny example #${i + 1} was allowed`])),
    ...allow.flatMap((call, i) => (verdict(call) === "deny" ? [`${rule.id}: allow example #${i + 1} was denied`] : [])),
  ];
}

/**
 * kj rules test (KJC-TSK-0945, MDR-B3): every deterministic rule against its own
 * deny/allow examples. A rule with no examples is untested, and that fails too.
 * @returns {{code: 0|1, lines: string[]}}
 */
export function rulesTest({ projectDir }) {
  const { present, rules, errors } = loadRules(projectDir);
  if (errors.length) return { code: 1, lines: errors.map((e) => `✗ ${e}`) };
  if (!present) return { code: 0, lines: [`no ${RULES_FILE}: nothing to test`] };
  const tested = rules.filter((rule) => rule.kind === "deterministic");
  const failures = tested.flatMap(exampleFailures);
  if (failures.length) return { code: 1, lines: failures.map((f) => `✗ ${f}`) };
  const examples = tested.reduce((n, rule) => n + rule.examples.deny.length + rule.examples.allow.length, 0);
  return { code: 0, lines: [`✓ ${tested.length} rule(s), ${examples} example(s)`] };
}

export const PROPOSAL_FILE = path.join(".karajan", "rules.proposed.yml");

/** What a proposed rule says against the MD files: it is one of their rules, word for word. */
function inventoryFailures(rule, inventory) {
  const written = inventory.get(rule.id);
  if (!written) return [`${rule.id}: no rule of the MD files has this id (kj rules list)`];
  return rule.text === written.text ? [] : [`${rule.id}: text is not what the MD says (${written.file}:${written.line}): ${written.text}`];
}

/**
 * kj rules check (KJC-TSK-0950, MDR-D1): a proposal of compiled rules proves
 * itself before a human reads it. Every rule is one of the MD files and cites
 * its literal text; every deterministic one passes its own examples.
 * @returns {{code: 0|1, lines: string[]}}
 */
export function rulesCheck({ projectDir, file = PROPOSAL_FILE, home }) {
  const { present, rules, errors } = loadRules(projectDir, file);
  if (!present) return { code: 1, lines: [`✗ no ${file}: nothing to check`] };
  if (errors.length) return { code: 1, lines: errors.map((e) => `✗ ${e}`) };
  const inventory = new Map(listRules(projectDir, home ? { home } : {}).map((rule) => [rule.id, rule]));
  const failures = rules.flatMap((rule) => [
    ...inventoryFailures(rule, inventory),
    ...(rule.kind === "deterministic" ? exampleFailures(rule) : []),
  ]);
  if (failures.length) return { code: 1, lines: failures.map((f) => `✗ ${f}`) };
  const count = (kind) => rules.filter((rule) => rule.kind === kind).length;
  return { code: 0, lines: [`✓ ${rules.length} rule(s) hold: ${count("deterministic")} deterministic, ${count("judgment")} judgment, ${count("out-of-scope")} out of scope`] };
}

/**
 * kj rules coverage (KJC-TSK-0941, MDR-E): every rule of the governing MD files
 * against rules.yml. `strict` fails while a rule has no gate or a compiled rule
 * is stale, so a rule nobody decided about cannot go unseen.
 * @returns {{code: 0|1, lines: string[], output?: object}}
 */
export function rulesCoverage({ projectDir, strict = false, home }) {
  const { rules, errors } = loadRules(projectDir);
  if (errors.length) return { code: 1, lines: errors.map((e) => `✗ ${e}`) };
  const { rows, stale } = coverage(listRules(projectDir, home ? { home } : {}), rules);
  const count = (status) => rows.filter((row) => row.status === status).length;
  const counts = { deterministic: count("deterministic"), judgment: count("judgment"), "out-of-scope": count("out-of-scope"), [NO_GATE]: count(NO_GATE), stale: stale.length };
  const ungated = rows.filter((row) => row.status === NO_GATE);
  const lines = [
    ...ungated.map((r) => `✗ no gate  ${r.id}  ${r.file}:${r.line}  ${r.text}`),
    ...stale.map((r) => `✗ stale    ${r.id}  ${r.source ?? "?"}  ${r.text ?? ""} (its text is in no MD any more: compile it again)`),
    `${rows.length} rule(s): ${counts.deterministic} deterministic, ${counts.judgment} judgment, ${counts["out-of-scope"]} out of scope, ${ungated.length} with no gate; ${stale.length} stale`,
  ];
  return { code: strict && ungated.length + stale.length > 0 ? 1 : 0, lines, output: { counts, rows, stale } };
}
