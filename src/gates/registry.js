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
  // KJC-TSK-1386: choices, not levels: only leaving "free" tightens; any other move loosens.
  { id: "commit-convention", key: "commit_convention", levels: ["free", "project", "conventional"], unordered: true, default: "conventional", text: "the commit message convention (conventional, the project's commitlint, or free)" },
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
  if (rule.unordered) return current === rule.levels[0] && next !== current && rule.levels.includes(next);
  return rule.levels.includes(next) && rule.levels.indexOf(next) > rule.levels.indexOf(current);
}

/**
 * @param {object} config the merged kj config
 * @param {{ tighten?: Array<{rule: string, value: unknown, by: string}>,
 *   project?: Record<string, {value: unknown, evidence: string}> }} [opts] tightenings declared by
 *   skills; what the project says (src/gates/project-conventions.js), between the defaults and kj.config.yml
 */
export function resolveRules(config, { tighten = [], project = {} } = {}) {
  // KJC-TSK-1387: what was declared, not the resolved values the loader puts in method_gates.
  const gates = config?.method_gates_declared || config?.method_gates || {};
  const adjustable = ADJUSTABLE_RULES.map((rule) => {
    const set = gates[rule.key];
    if (set !== undefined && set !== defaultOf(rule)) return { ...rule, value: set, origin: "kj.config.yml" };
    const said = project[rule.id];
    if (said) return { ...rule, value: said.value, origin: `project: ${said.evidence}` };
    return { ...rule, value: defaultOf(rule), origin: "default" };
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
export function formatRules({ fixed, adjustable, ignored = [], conflicts = [], stale = [] }) {
  const pad = Math.max(...adjustable.map((r) => r.id.length));
  return [
    "Fixed rules (no one changes them):",
    ...fixed.map((r) => `  🔒 ${r.id}: ${r.text}`),
    "",
    "Adjustable rules (value, who set it):",
    ...adjustable.map((r) => `  ${r.id.padEnd(pad)}  ${r.value}  (${r.origin}): ${r.text}`),
    ...ignored.map((i) => `  ✗ ignored from skill ${i.by}: ${i.rule} → ${i.value} (${i.reason})`),
    // KJC-TSK-1391: what the project's CONTRIBUTING says against a fixed rule, and settings gone stale.
    ...conflicts.map((c) => `  ⚠ conflict with the fixed rule ${c.rule}: ${c.file} says "${c.quote}" (the rule stays; decide whether to use Karajan here)`),
    ...stale.map((s) => `  ✗ ${s.rule} → ${s.value} no longer applies: ${s.reason}`),
    "",
    "Ask your agent to change an adjustable rule; kj gates shows this list again.",
  ].join("\n");
}
