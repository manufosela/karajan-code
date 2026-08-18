/**
 * Gate determinista de policy en el flujo de review (PL-B, KJC-TSK-0734).
 * Evalúa el diff staged contra `.karajan/policy.yml` + defaults del motor:
 * `enforcement: warn` avisa, `enforcement: deny` cierra el gate. La única
 * salida de un deny es la excepción probatoria (KJ_ALLOW_POLICY=1 +
 * KJ_POLICY_REASON escrito en el momento, registrada con identidad y hash
 * del diff) — y `class: security` no tiene salida: ni escape ni arbitraje.
 * Puro: quien lo cablea (review-gate) imprime y decide el exit code.
 */
import { checkStagedDiff } from "../policy/engine.js";

/**
 * @returns {{ok: boolean, invalid?: boolean, warns: object[], denials: object[], exempted: object[]}}
 */
export function evaluatePolicyGate({
  policy, errors = [], role = "coder", files = [], netLinesAdded = null,
  diffHashValue = null, env = process.env, recordException = () => {},
}) {
  if (errors.length > 0) {
    return { ok: false, invalid: true, warns: [], denials: errors.map((e) => ({ rule_id: "policy.load", reason: e })), exempted: [] };
  }
  const violations = checkStagedDiff(policy, { role, files, netLinesAdded });
  const warns = violations.filter((v) => v.enforcement !== "deny");
  const hard = violations.filter((v) => v.enforcement === "deny");
  const denials = [];
  const exempted = [];
  for (const v of hard) {
    if (v.class === "security") {
      denials.push(v); // seguridad: sin escape y sin arbitraje — no negociable
      continue;
    }
    if (env.KJ_ALLOW_POLICY === "1") {
      const justification = (env.KJ_POLICY_REASON || "").trim();
      if (!justification) {
        denials.push({ ...v, reason: `${v.reason} — la excepción exige justificación escrita en el momento (KJ_POLICY_REASON="por qué")` });
        continue;
      }
      exempted.push(recordException({ rule_id: v.rule_id, violation: v.reason, file: v.file, justification, diffHash: diffHashValue, scope: "este diff exacto" }) ?? v);
      continue;
    }
    denials.push(v);
  }
  return { ok: denials.length === 0, warns, denials, exempted };
}
