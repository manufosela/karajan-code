/**
 * Gate de Decisión del kernel (PL-B KJC-TSK-0734 → GOV-A KJC-TSK-0745).
 * Evalúa los artefactos afectados contra la política + defaults del
 * consumidor: `enforcement: warn` avisa, `enforcement: deny` cierra. La
 * única salida de un deny es la excepción probatoria — pedida
 * EXPLÍCITAMENTE por el adaptador ({requested, justification}: cómo se
 * pide en cada dominio, env vars en code, no es asunto del kernel) y
 * registrada con identidad y hash del artefacto. Lo inexcepcionable
 * (class security) no tiene salida: ni excepción ni arbitraje. Puro:
 * quien lo cablea imprime y decide el exit code.
 */
import { checkArtifacts } from "./engine.js";

/**
 * @returns {{ok: boolean, invalid?: boolean, warns: object[], denials: object[], exempted: object[]}}
 */
export function evaluateGate({
  policy, errors = [], role = "coder", files = [], netLinesAdded = null,
  artifactHash = null, exemption = {}, recordException = () => {},
  standingExceptions = [], now = new Date(),
}) {
  if (errors.length > 0) {
    return { ok: false, invalid: true, warns: [], denials: errors.map((e) => ({ rule_id: "policy.load", reason: e })), exempted: [] };
  }
  const violations = checkArtifacts(policy, { role, files, netLinesAdded });
  const warns = violations.filter((v) => v.enforcement !== "deny");
  const hard = violations.filter((v) => v.enforcement === "deny");
  const denials = [];
  const exempted = [];
  // GOV-B (KJC-TSK-0746): standing exceptions — permanentes YA concedidas
  // (cargadas por el adaptador de su almacén; el kernel no hace I/O) que
  // eximen la regla exacta mientras VIVEN. `now` lo pone quien evalúa:
  // la caducidad es la regla, no una sugerencia.
  // Registros legacy (PL-B, sin scopeKind) se normalizan a `puntual` — su
  // tipo efectivo de siempre: eximieron EN su momento ligados a un diff y
  // jamás se re-consultaron. Solo una permanente explícita y VIVA da standing.
  const alive = (s) => (s.scopeKind ?? "puntual") === "permanente" && Date.parse(s.expiresAt) > now.getTime();
  for (const v of hard) {
    if (v.class === "security") {
      denials.push(v); // inexcepcionable: sin escape, sin arbitraje, sin standing
      continue;
    }
    const st = standingExceptions.find((s) => s.rule_id === v.rule_id && alive(s));
    if (st) {
      exempted.push({ ...v, standing: st });
      continue;
    }
    if (exemption.requested) {
      const justification = (exemption.justification || "").trim();
      if (!justification) {
        // El kernel dice QUÉ falta; el `hint` del adaptador dice CÓMO se
        // aporta en su dominio (en code: la env var KJ_POLICY_REASON).
        const how = exemption.hint ? ` (${exemption.hint})` : "";
        denials.push({ ...v, reason: `${v.reason} — la excepción exige justificación escrita en el momento${how}` });
        continue;
      }
      exempted.push(recordException({ rule_id: v.rule_id, violation: v.reason, file: v.file, justification, diffHash: artifactHash, scope: "este artefacto exacto" }) ?? v);
      continue;
    }
    denials.push(v);
  }
  return { ok: denials.length === 0, warns, denials, exempted };
}
