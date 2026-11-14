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

// KJC-TSK-1411: in a list a key is an index (questions.1 is the second question); own properties only.
const step = (node, key) => {
  if (Array.isArray(node)) return /^\d+$/.test(key) ? node[Number(key)] : undefined;
  return isObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
};

/** The value at a dotted path of the tool input. */
const at = (input, dotted) => dotted.split(".").reduce(step, input);

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
  // KJC-BUG-0487 (#3328): multiline, so ^ and $ hold at every line: a newline separates
  // commands like a semicolon does, and a boundary written as (^|;|&&) sees each one.
  if ("matches" in cond) return typeof value === "string" && new RegExp(cond.matches, "m").test(value);
  if (typeof value !== "number" || Number.isNaN(value)) return false;
  return "gt" in cond ? value > cond.gt : value < cond.lt;
}

const applies = (rule, tool, input) =>
  toolsOf(rule.when).some((glob) => toolMatches(glob, tool))
  && (rule.when.all ?? []).every((cond) => holds(cond, input))
  && (!rule.when.any?.length || rule.when.any.some((cond) => holds(cond, input)));

// KJC-BUG-0592: `handoff add '<cmd>' --why <text>`, one small pattern per part.
const HANDOFF_ADD = /handoff\s+add\s+/g;
/**
 * Quoted text the shell keeps as is. In double quotes a backslash keeps the next character
 * literal (\" \$ \`), while a bare $ or ` expands it (a $(...) runs at registration).
 */
const QUOTED = /^(?:'[^']*'|"(?:[^"\\$`]|\\[\s\S])*")/;
const WHY_FLAG = /^\s+--why\s+/;
/** A bare word: no quote, escape, expansion or operator in it. */
const PLAIN_WORD = /^[^\s|&;()<>'"`$\\]+/;

/** What pattern matches at the very start of text ("" when nothing does). */
const leading = (pattern, text) => pattern.exec(text)?.[0] ?? "";

/**
 * The quoted command that opens rest and the --why right after it.
 * @returns {{span: number, blank: string} | null} the characters they take and their stand-in; null without a command
 */
function registration(rest) {
  const command = leading(QUOTED, rest);
  if (!command) return null;
  const flag = leading(WHY_FLAG, rest.slice(command.length));
  const whyText = rest.slice(command.length + flag.length);
  const why = flag && (leading(QUOTED, whyText) || leading(PLAIN_WORD, whyText));
  if (!why) return { span: command.length, blank: "'_'" };
  return { span: command.length + flag.length + why.length, blank: "'_' --why '_'" };
}

/**
 * KJC-BUG-0592: `kj handoff add '<cmd>' --why "..."` only REGISTERS <cmd> for the human to
 * run later; a rule about running an act must not fire on that data. Blank the quoted
 * command (and the --why prose) of handoff add; the rest of the command stays visible.
 * @param {string} command the Bash command of the tool call
 * @returns {string} the same command with what handoff add registers blanked
 */
export function blankHandoffAdd(command) {
  let out = "";
  let from = 0;
  for (const head of command.matchAll(HANDOFF_ADD)) {
    const start = head.index + head[0].length;
    const found = head.index < from ? null : registration(command.slice(start));
    if (!found) continue;
    out += command.slice(from, start) + found.blank;
    from = start + found.span;
  }
  return out + command.slice(from);
}

const forMatching = (tool, input) =>
  tool === "Bash" && typeof input.command === "string" ? { ...input, command: blankHandoffAdd(input.command) } : input;

/**
 * @param {object[]} rules what parseRules returned
 * @param {{tool: string, input?: object}} call
 * @returns {{decision: "allow"} | {decision: "deny", rule_id: string, source: string|null, text: string|null, message: string}}
 */
export function evalRules(rules, { tool, input }) {
  const args = forMatching(tool, isObject(input) ? input : {});
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
