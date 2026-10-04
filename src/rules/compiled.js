/**
 * Compiled rules, the format (KJC-TSK-0938, MDR-B, ADR 0016). A rule from the MD
 * files, compiled into a condition over a tool call: which tool, which arguments.
 * The operators are a closed set, so a rule is auditable and runs with no model.
 * `judgment` rules carry no condition to evaluate: the judge reads them.
 *
 * An invalid file yields no rules (a rule that lies is worse than none).
 */
import yaml from "js-yaml";

const ID = /^R-[0-9a-f]{10}$/;
const KINDS = ["deterministic", "judgment"];
const OPERATORS = ["equals", "in", "matches", "exists", "gt", "lt"];

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** The tool globs a rule names (`when.tool` is one glob or a list). */
export const toolsOf = (when) => [when?.tool].flat().filter((t) => typeof t === "string" && t);

// The format is closed at every level: a key nobody reads would be a condition
// the author believes in and the evaluator ignores.
const RULE_KEYS = ["id", "source", "text", "kind", "when", "message", "examples"];
const WHEN_KEYS = ["tool", "all", "any"];
const CONDITION_KEYS = ["arg", "days_from", ...OPERATORS];
const unknownKeys = (obj, known) => (isObject(obj) ? Object.keys(obj).filter((k) => !known.includes(k)) : []);

const isRegex = (source) => {
  try { new RegExp(source); return typeof source === "string"; } catch { return false; }
};
/** What each operator takes; anything else invalidates the condition. */
const OPERAND = {
  equals: () => true,
  in: Array.isArray,
  matches: isRegex,
  exists: (v) => typeof v === "boolean",
  gt: Number.isFinite,
  lt: Number.isFinite,
};

/** A dotted path into the tool input: non-empty segments (`updates.status`). */
const isPath = (v) => typeof v === "string" && /^[\w-]+(\.[\w-]+)*$/.test(v);

function conditionErrors(cond) {
  if (!isObject(cond) || !isPath(cond.arg)) return ["a condition needs an `arg` (dotted path into the tool input)"];
  const where = `condition on ${cond.arg}`;
  const unknown = unknownKeys(cond, CONDITION_KEYS);
  if (unknown.length) return [`${where}: unknown key ${unknown.join(", ")} (operators: ${OPERATORS.join(", ")})`];
  const ops = OPERATORS.filter((op) => op in cond);
  if (ops.length !== 1) return [`${where}: exactly one operator of ${OPERATORS.join(", ")}`];
  const [op] = ops;
  if (!OPERAND[op](cond[op])) return [`${where}: invalid operand for ${op}${op === "matches" ? " (not a valid regex)" : ""}`];
  if ("days_from" in cond && (!isPath(cond.days_from) || !["gt", "lt"].includes(op))) {
    return [`${where}: days_from names another argument and compares with gt or lt`];
  }
  return [];
}

function ruleErrors(rule) {
  if (!isObject(rule)) return ["a rule is a mapping"];
  const errors = [];
  const unknown = [...unknownKeys(rule, RULE_KEYS), ...unknownKeys(rule.when, WHEN_KEYS).map((k) => `when.${k}`)];
  if (unknown.length) errors.push(`unknown key ${unknown.join(", ")}`);
  if (!ID.test(String(rule.id))) errors.push("id must be an inventory id (R- and 10 hex chars)");
  if (!KINDS.includes(rule.kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  const notText = ["source", "text", "message"].filter((k) => k in rule && typeof rule[k] !== "string");
  if (notText.length) errors.push(`${notText.join(", ")} must be text`);
  // `examples` are tool calls: the command that runs them checks their shape (kj rules test).
  const tools = [rule.when?.tool].flat();
  if (tools.length === 0 || tools.some((t) => typeof t !== "string" || !t)) errors.push("when.tool names the tool: a glob, or a list where every item is one");
  const lists = [rule.when?.all, rule.when?.any].filter((list) => list !== undefined);
  if (lists.some((list) => !Array.isArray(list))) errors.push("when.all and when.any are lists of conditions");
  else for (const cond of lists.flat()) errors.push(...conditionErrors(cond));
  return errors;
}

/**
 * @param {string} text the content of .karajan/rules.yml
 * @returns {{rules: object[], errors: string[]}} no rules when there is any error
 */
export function parseRules(text) {
  let doc;
  try { doc = yaml.load(text); } catch (err) { return { rules: [], errors: [`invalid YAML: ${err.message.split("\n")[0]}`] }; }
  if (!isObject(doc) || doc.version !== 1) return { rules: [], errors: ["version must be 1"] };
  const unknown = unknownKeys(doc, ["version", "rules"]);
  if (unknown.length) return { rules: [], errors: [`unknown key ${unknown.join(", ")}`] };
  if (!Array.isArray(doc.rules)) return { rules: [], errors: ["rules must be a list"] };
  const errors = doc.rules.flatMap((rule, i) => ruleErrors(rule).map((e) => `rules[${i}] (${rule?.id ?? "no id"}): ${e}`));
  return { rules: errors.length ? [] : doc.rules, errors };
}
