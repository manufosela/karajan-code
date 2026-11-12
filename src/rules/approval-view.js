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

// KJC-TSK-1410: a rule approved before and proposed again as it is was already read by the human.
export const shape = (rule) => JSON.stringify([rule.kind, rule.text, rule.when ?? null, rule.reason ?? null]);

/**
 * KJC-BUG-0568: unchanged means the same shape AND the same source. The source decides whether the
 * rule is installed in the versioned file or the local one, so moving it is a change.
 */
export const isUnchanged = (rule, approved) => approved !== undefined && shape(rule) === shape(approved) && rule.source === approved.source;

/** A line saying where a rule moves when its source changed, or none. */
const moved = (rule, approved) => (approved && rule.source !== approved.source ? [`    source: ${approved.source ?? "none"} → ${rule.source ?? "none"}`] : []);

/**
 * @param {object[]} proposed the rules of a checked proposal
 * @param {object[]} current the rules approved today (both files)
 * @param {Set<string>} local ids that go to the unversioned file
 * @param {{versioned: string, unversioned: string}} files the two rules files, as shown
 * @param {{all?: boolean}} [opts] all: list the unchanged rules too
 * @returns {string[]} lines, ready to print
 */
export function approvalView(proposed, current, local, files, { all = false } = {}) {
  const approved = new Map(current.map((rule) => [rule.id, rule]));
  const unchanged = all ? [] : proposed.filter((rule) => isUnchanged(rule, approved.get(rule.id)));
  if (unchanged.length) {
    const same = new Set(unchanged.map((rule) => rule.id));
    const changes = approvalView(proposed.filter((rule) => !same.has(rule.id)), current.filter((rule) => !same.has(rule.id)), local, files, { all: true });
    return [...changes, `${unchanged.length} rule(s) unchanged from what is approved today, not listed: kj rules approve --all shows them.`];
  }
  const where = (rule) => (local.has(rule.id) ? `${files.unversioned}, not versioned` : files.versioned);
  const shown = (rule) => [`${rule.id}  ${rule.kind}  → ${where(rule)}`, `    ${rule.text}`, `    ${compiled(rule)}`, ...moved(rule, approved.get(rule.id))];
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
      `${rule.id}  ${how}  → ${where(rule)}`, `    ${rule.text}`, `    was: ${compiled(approved.get(rule.id))}`, `    now: ${compiled(rule)}`, ...moved(rule, approved.get(rule.id)),
    ])),
    ...block(`${ungated.length} rule(s) with NO effective gate: nothing is blocked on them.`, ungated.flatMap(shown)),
    ...block(`${gates.length} ${GATE} gate(s):`, gates.flatMap(shown)),
    ...block(`${leaving.length} rule(s) LEAVE:`, leaving.map((rule) => `${rule.id}  ${rule.text ?? ""}`)),
  ];
}
