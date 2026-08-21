/**
 * PL-E (KJC-TSK-0767) — el informe de policy, PURO (líneas del decision log +
 * excepciones + policy + reloj ⇒ objeto determinista; cero I/O, cero LLM).
 * Responde: ¿qué reglas avisan y cuánto (gana dientes con datos)?, ¿qué
 * denegaciones siguen abiertas (la renuncia deja rastro)?, ¿qué concesiones
 * viven, vencen o se renuevan (la renovación es señal)?
 */
import { verifyDecisionChain } from "@karajan-family/governance";

const DAY_MS = 86_400_000;
const WARN_SIGNAL_MIN = 5;

/** enforcement/class de una regla según la policy cargada (null si no se sabe). */
function ruleMeta(policy, ruleId) {
  if (!policy) return {};
  if (ruleId.startsWith("defaults.")) return { enforcement: "deny", class: "security" };
  const m = /^roles\.([^.]+)\.([^.]+)/.exec(ruleId);
  const spec = m ? policy.roles?.[m[1]]?.[m[2]] : policy.invariants?.find((i) => i.id === ruleId);
  if (!spec) return {};
  return { enforcement: spec.enforcement || "warn", ...(spec.class ? { class: spec.class } : {}) };
}

function parseDecisions(lines) {
  const records = [];
  let discarded = 0;
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (typeof rec === "object" && rec !== null) records.push(rec);
      else discarded += 1;
    } catch {
      discarded += 1;
    }
  }
  return { records, discarded };
}

// Abiertas = denies posteriores al último allow/exempt: el log acaba en
// rechazo sin que nada haya pasado después. Heurística declarada — el log
// no lleva rama ni autor, así que no distingue "arreglado" de "abandonado".
const lastResolvedIndex = (records) => records.findLastIndex((r) => r.decision === "allow" || r.decision === "exempt");

function tallyRules(records, policy, lastResolved) {
  const rules = new Map();
  const row = (id) => {
    if (!rules.has(id)) rules.set(id, { rule_id: id, ...ruleMeta(policy, id), warns: 0, denies: 0, exempts: 0, open: 0 });
    return rules.get(id);
  };
  // Un sello lleva un rule_id por FICHERO violador: se cuentan decisiones
  // por regla, no ficheros — de ahí el Set por entrada.
  const ids = (list) => new Set(list ?? []);
  records.forEach((rec, i) => {
    for (const id of ids(rec.warn_rule_ids)) row(id).warns += 1;
    if (rec.decision === "deny") for (const id of ids(rec.rule_ids)) { row(id).denies += 1; if (i > lastResolved) row(id).open += 1; }
    if (rec.decision === "exempt") for (const id of ids(rec.rule_ids)) row(id).exempts += 1;
  });
  return [...rules.values()].toSorted((a, b) => (b.denies + b.warns) - (a.denies + a.warns));
}

function tallyGrants(exceptionRecords, now, soonDays) {
  const perm = exceptionRecords.filter((e) => e?.scopeKind === "permanente");
  // Una caducidad ilegible (NaN) NO está viva: la excepción falla cerrada.
  const alive = [];
  const expired = [];
  for (const e of perm) (Date.parse(e.expiresAt) > now.getTime() ? alive : expired).push(e);
  const soon = alive.filter((e) => Date.parse(e.expiresAt) - now.getTime() <= soonDays * DAY_MS);
  const counts = Map.groupBy(perm, (e) => e.rule_id);
  const renewals = [...counts].filter(([, v]) => v.length >= 2).map(([rule_id, v]) => ({ rule_id, count: v.length }));
  return { alive, expired, soon, renewals, point: exceptionRecords.length - perm.length };
}

function signalsFor(rules, grants) {
  const out = [];
  for (const g of grants.renewals) out.push(`[${g.rule_id}] concedida ${g.count} veces — una excepción que se renueva ya no es una excepción: es la política pidiendo cambio (PR a .karajan/policy.yml)`);
  for (const r of rules) {
    if (r.warns >= WARN_SIGNAL_MIN && r.denies === 0 && r.enforcement !== "deny") out.push(`[${r.rule_id}] ha avisado ${r.warns} veces y nunca ha bloqueado — decide: promover a enforcement=deny o retirarla; un aviso perpetuo es ruido`);
    if (r.open > 0) out.push(`[${r.rule_id}] ${r.open} denegación(es) abierta(s) — el log acaba en rechazo: ¿arreglo pendiente, excepción por pedir, o renuncia?`);
  }
  for (const g of grants.soon) out.push(`[${g.rule_id}] vence ${g.expiresAt} — al vencer vuelve a bloquear sola; renueva por su cauce o deja que caduque`);
  return out;
}

/**
 * @returns {{chain: object, decisions: object, rules: object[], grants: object, signals: string[]}}
 */
export function buildPolicyReport({ decisionLines = [], exceptionRecords = [], policy = null, now = new Date(), soonDays = 7 } = {}) {
  const chain = decisionLines.length ? verifyDecisionChain(decisionLines) : { ok: true, length: 0 };
  const { records, discarded } = parseDecisions(decisionLines);
  const count = (d) => records.filter((r) => r.decision === d).length;
  const chokepoints = Object.fromEntries([...Map.groupBy(records, (r) => r.chokepoint ?? "unknown")].map(([k, v]) => [k, v.length]));
  const lastResolved = lastResolvedIndex(records);
  const rules = tallyRules(records, policy, lastResolved);
  const grants = tallyGrants(exceptionRecords, now, soonDays);
  const decisions = {
    total: records.length, discarded, allow: count("allow"), deny: count("deny"), exempt: count("exempt"),
    open: records.filter((r, i) => r.decision === "deny" && i > lastResolved).length, chokepoints,
  };
  return { chain, decisions, rules, grants, signals: signalsFor(rules, grants) };
}
