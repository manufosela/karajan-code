/**
 * kj rules eval (KJC-TSK-0943, MDR-B2, ADR 0016): the hook's contract, the same
 * as `kj policy eval --strict`. One tool call in, a JSON verdict out, exit
 * 0 = allow, 2 = deny, 1 = it could not be evaluated (invalid or unreadable
 * rules.yml, unreadable input).
 */
import fs from "node:fs";
import path from "node:path";

import { isObject, parseRules } from "../rules/compiled.js";
import { evalRules } from "../rules/evaluate.js";

export const RULES_FILE = path.join(".karajan", "rules.yml");

/**
 * The compiled rules of a project. A file that does not exist is no rules; a
 * file that exists and cannot be read is an error (rules silently off would be
 * every call allowed).
 */
export function loadRules(projectDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(projectDir, RULES_FILE), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { present: false, rules: [], errors: [] };
    return { present: true, rules: [], errors: [`cannot read ${RULES_FILE}: ${err.code || err.message}`] };
  }
  return { present: true, ...parseRules(text) };
}

const failed = (...errors) => ({ code: 1, output: { errors } });

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
