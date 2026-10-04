/**
 * The deterministic evaluator of compiled rules (KJC-TSK-0944, MDR-B1, ADR 0016):
 * one tool call against the rules parseRules accepted, with no model.
 *
 * A rule says when to deny. A condition over an argument the call does not
 * carry, or cannot be read as the operator needs (a date, a number), does not
 * hold: the rule states a fact about the call, and that fact is not there.
 */
import { isObject, toolsOf } from "./compiled.js";

const DAY_MS = 86_400_000;

/** A tool glob: `*` stands for any run of characters, the rest is literal. */
const toolMatches = (glob, tool) => {
  const literal = glob.split("*").map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`));
  return new RegExp(`^${literal.join(".*")}$`).test(String(tool));
};

/** The value at a dotted path of the tool input, own properties only. */
const at = (input, dotted) =>
  dotted.split(".").reduce((node, key) => (isObject(node) && Object.hasOwn(node, key) ? node[key] : undefined), input);

/** Calendar days (UTC) from one date to another: the same day is 0, whatever the hour. */
const daysBetween = (from, to) => Math.floor(Date.parse(to) / DAY_MS) - Math.floor(Date.parse(from) / DAY_MS);

function holds(cond, input) {
  let value = at(input, cond.arg);
  const present = value !== undefined && value !== null;
  if ("exists" in cond) return present === cond.exists;
  if (!present) return false;
  if ("days_from" in cond) value = daysBetween(at(input, cond.days_from), value);
  if ("equals" in cond) return value === cond.equals;
  if ("in" in cond) return cond.in.includes(value);
  if ("matches" in cond) return typeof value === "string" && new RegExp(cond.matches).test(value);
  if (typeof value !== "number" || Number.isNaN(value)) return false;
  return "gt" in cond ? value > cond.gt : value < cond.lt;
}

const applies = (rule, tool, input) =>
  toolsOf(rule.when).some((glob) => toolMatches(glob, tool))
  && (rule.when.all ?? []).every((cond) => holds(cond, input))
  && (!rule.when.any?.length || rule.when.any.some((cond) => holds(cond, input)));

/**
 * @param {object[]} rules what parseRules returned
 * @param {{tool: string, input?: object}} call
 * @returns {{decision: "allow"} | {decision: "deny", rule_id: string, source: string|null, text: string|null, message: string}}
 */
export function evalRules(rules, { tool, input }) {
  const args = isObject(input) ? input : {};
  const hit = rules.find((rule) => rule.kind === "deterministic" && applies(rule, tool, args));
  if (!hit) return { decision: "allow" };
  return {
    decision: "deny",
    rule_id: hit.id,
    source: hit.source ?? null,
    text: hit.text ?? null,
    message: hit.message ?? hit.text ?? `rule ${hit.id}`,
  };
}
