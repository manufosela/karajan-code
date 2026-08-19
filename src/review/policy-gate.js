/**
 * Adaptador del gate de policy en el flujo de review de karajan-code
 * (GOV-A, KJC-TSK-0745). La decisión warn/deny/inexcepcionable/excepción
 * vive en el kernel (@karajan-family/governance); aquí solo el dominio: la
 * excepción se pide con KJ_ALLOW_POLICY=1 + KJ_POLICY_REASON, y el
 * artefacto de este dominio es el diff staged — por eso el alcance
 * registrado dice "este diff exacto".
 */
import { evaluateGate } from "@karajan-family/governance";

/**
 * @returns {{ok: boolean, invalid?: boolean, warns: object[], denials: object[], exempted: object[]}}
 */
export function evaluatePolicyGate({
  policy, errors = [], role = "coder", files = [], netLinesAdded = null,
  diffHashValue = null, env = process.env, recordException = () => {},
  standingExceptions = [], now = new Date(),
}) {
  return evaluateGate({
    policy, errors, role, files, netLinesAdded,
    artifactHash: diffHashValue,
    exemption: { requested: env.KJ_ALLOW_POLICY === "1", justification: env.KJ_POLICY_REASON, hint: 'KJ_POLICY_REASON="por qué"' },
    recordException: (entry) => recordException({ ...entry, scope: "este diff exacto" }),
    standingExceptions, now,
  });
}
