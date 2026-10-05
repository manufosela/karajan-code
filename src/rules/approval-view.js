/**
 * What the human reads before approving compiled rules (KJC-TSK-0962, MDR-F3,
 * ADR 0017), in the order of what can hurt. The agent the rules will watch wrote
 * the proposal, so a weak compilation must not hide among a hundred rules:
 *
 *   1. what loses or changes force against what is approved today;
 *   2. what has no effective gate (judgment and out-of-scope block nothing);
 *   3. the deterministic gates;
 *   4. the approved rules that leave.
 */
const GATE = "deterministic";

const compiled = (rule) => {
  if (rule.kind === "out-of-scope") return `reason: ${rule.reason}`;
  // KJC-TSK-0973: why a judgment rule takes no condition is read next to it.
  const why = rule.reason ? "  (" + rule.reason + ")" : "";
  return `when: ${JSON.stringify(rule.when)}${why}`;
};

/** How a proposed rule weakens or changes the approved one, or "" when it does not. */
function weakening(rule, approved) {
  if (approved?.kind !== GATE) return "";
  if (rule.kind !== GATE) return `was ${GATE}, now ${rule.kind}`;
  return JSON.stringify(rule.when) === JSON.stringify(approved.when) ? "" : "condition changed";
}

/**
 * @param {object[]} proposed the rules of a checked proposal
 * @param {object[]} current the rules approved today (both files)
 * @param {Set<string>} local ids that go to the unversioned file
 * @param {{versioned: string, unversioned: string}} files the two rules files, as shown
 * @returns {string[]} lines, ready to print
 */
export function approvalView(proposed, current, local, files) {
  const approved = new Map(current.map((rule) => [rule.id, rule]));
  const where = (rule) => (local.has(rule.id) ? `${files.unversioned}, not versioned` : files.versioned);
  const shown = (rule) => [`${rule.id}  ${rule.kind}  → ${where(rule)}`, `    ${rule.text}`, `    ${compiled(rule)}`];
  const weakened = proposed.map((rule) => ({ rule, how: weakening(rule, approved.get(rule.id)) })).filter(({ how }) => how);
  const seen = new Set(weakened.map(({ rule }) => rule.id));
  const rest = proposed.filter((rule) => !seen.has(rule.id));
  const ungated = rest.filter((rule) => rule.kind !== GATE);
  const gates = rest.filter((rule) => rule.kind === GATE);
  const ids = new Set(proposed.map((rule) => rule.id));
  const leaving = current.filter((rule) => !ids.has(rule.id));
  const block = (title, lines) => (lines.length ? [title, ...lines, ""] : []);
  return [
    ...block(`⚠ ${weakened.length} rule(s) LOSE or CHANGE force against what is approved today:`, weakened.flatMap(({ rule, how }) => [
      `${rule.id}  ${how}  → ${where(rule)}`, `    ${rule.text}`, `    was: ${compiled(approved.get(rule.id))}`, `    now: ${compiled(rule)}`,
    ])),
    ...block(`${ungated.length} rule(s) with NO effective gate: nothing is blocked on them.`, ungated.flatMap(shown)),
    ...block(`${gates.length} ${GATE} gate(s):`, gates.flatMap(shown)),
    ...block(`${leaving.length} rule(s) LEAVE:`, leaving.map((rule) => `${rule.id}  ${rule.text ?? ""}`)),
  ];
}
