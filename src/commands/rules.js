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
