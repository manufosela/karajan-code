/**
 * Rule coverage (KJC-TSK-0941, MDR-E, ADR 0016): the inventory of the MD files
 * against the compiled rules, by id. The id hashes the rule's text, so a rule
 * whose text changed in its MD is a new rule with no gate, and what was compiled
 * for the old text is stale: it is in no MD any more.
 */

export const NO_GATE = "none";

/**
 * @param {{id: string}[]} inventory what listRules returned
 * @param {{id: string, kind: string}[]} compiled what parseRules accepted
 * @returns {{rows: object[], stale: object[]}} one row per inventory rule, with
 *   its `status` (the kind it was compiled to, or "none"); and the stale compiled rules
 */
export function coverage(inventory, compiled) {
  const kinds = new Map(compiled.map((rule) => [rule.id, rule.kind]));
  const rows = new Map();
  for (const rule of inventory) {
    if (!rows.has(rule.id)) rows.set(rule.id, { ...rule, status: kinds.get(rule.id) ?? NO_GATE });
  }
  return { rows: [...rows.values()], stale: compiled.filter((rule) => !rows.has(rule.id)) };
}
