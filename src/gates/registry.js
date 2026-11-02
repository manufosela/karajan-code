/**
 * KJC-TSK-1384 (ADR 0045): the rules kj governs with, in one registry. Fixed rules change
 * for no one. Each adjustable rule maps to its method_gates key, takes its value from the
 * config (else its default) and says who set it; a skill may only tighten it.
 */
import { DEFAULTS } from "../config/defaults.js";

export const FIXED_RULES = [
  { id: "card-first", text: "a card before code, and never a commit on the base branch" },
  { id: "cross-ai-review", text: "every diff reviewed by a different AI, bound to the exact diff" },
  { id: "security", text: "security findings are never arbitrated; the security audit runs before the review" },
  { id: "no-ai-attribution", text: "no AI attribution in commits or pull requests" },
  { id: "privacy", text: "nothing personal or secret-shaped is published" },
];

// levels go from loosest to strictest; for a number, lower is stricter.
export const ADJUSTABLE_RULES = [
  { id: "pr-size", key: "pr_size", levels: ["warn", "block"], default: "warn", text: "a PR over its maximum size" },
  { id: "pr-size-ideal", key: "pr_size_warn", number: true, text: "ideal net lines of code per PR" },
  { id: "pr-size-max", key: "pr_size_max", number: true, text: "maximum net lines of code per PR" },
  { id: "tests-with-code", key: "tests_with_code", levels: ["warn", "block"], text: "source changes without a test change" },
  { id: "dep-cooldown", key: "dep_cooldown", levels: ["warn", "block"], text: "a dependency published too recently" },
  { id: "mutation", key: "mutation", levels: ["off", "warn", "block"], default: "off", text: "surviving mutants after green" },
  { id: "claims", key: "claims", levels: ["off", "warn", "block"], text: "data in a final message its own source denies" },
  { id: "steward", key: "steward", levels: ["inform", "block"], default: "inform", text: "a broken project state when work starts" },
];

const defaultOf = (rule) => DEFAULTS.method_gates[rule.key] ?? rule.default;

/** The value as the rule takes it, or an error naming what it takes. */
export function parseRuleValue(rule, raw) {
  if (rule.number) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${rule.id} takes a positive whole number, not "${raw}"`);
    return n;
  }
  if (!rule.levels.includes(raw)) throw new Error(`${rule.id} takes ${rule.levels.join(", ")}, not "${raw}"`);
  return raw;
}

/** True when `next` is stricter than `current` for this rule. */
export function stricter(rule, current, next) {
  if (rule.number) return typeof next === "number" && next < current;
  return rule.levels.includes(next) && rule.levels.indexOf(next) > rule.levels.indexOf(current);
}

/**
 * @param {object} config the merged kj config
 * @param {{ tighten?: Array<{rule: string, value: unknown, by: string}> }} [opts] tightenings declared by skills
 */
export function resolveRules(config, { tighten = [] } = {}) {
  const gates = config?.method_gates || {};
  const adjustable = ADJUSTABLE_RULES.map((rule) => {
    const value = gates[rule.key] ?? defaultOf(rule);
    return { ...rule, value, origin: value === defaultOf(rule) ? "default" : "kj.config.yml" };
  });
  const ignored = [];
  for (const t of tighten) {
    const entry = adjustable.find((r) => r.id === t.rule);
    if (entry && stricter(entry, entry.value, t.value)) Object.assign(entry, { value: t.value, origin: `skill:${t.by}` });
    else ignored.push({ ...t, reason: entry ? "it would loosen the rule" : "not an adjustable rule" });
  }
  return { fixed: FIXED_RULES, adjustable, ignored };
}

/** The list `kj gates` prints. */
export function formatRules({ fixed, adjustable, ignored = [] }) {
  const pad = Math.max(...adjustable.map((r) => r.id.length));
  return [
    "Fixed rules (no one changes them):",
    ...fixed.map((r) => `  🔒 ${r.id}: ${r.text}`),
    "",
    "Adjustable rules (value, who set it):",
    ...adjustable.map((r) => `  ${r.id.padEnd(pad)}  ${r.value}  (${r.origin}): ${r.text}`),
    ...ignored.map((i) => `  ✗ ignored from skill ${i.by}: ${i.rule} → ${i.value} (${i.reason})`),
    "",
    "Ask your agent to change an adjustable rule; kj gates shows this list again.",
  ].join("\n");
}
