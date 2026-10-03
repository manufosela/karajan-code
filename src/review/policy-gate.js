/**
 * Adaptador del gate de policy en el flujo de review de karajan-code
 * (GOV-A, KJC-TSK-0745). La decisión warn/deny/inexcepcionable/excepción
 * vive en el kernel (@karajan-family/governance); aquí solo el dominio: el
 * artefacto es el diff staged. Sin excepción por diff (ADR 0015,
 * KJC-TSK-0932): una regla que falla se corrige por PR.
 */
import { evaluateGate } from "@karajan-family/governance";

/**
 * @returns {{ok: boolean, invalid?: boolean, warns: object[], denials: object[], exempted: object[]}}
 */
export function evaluatePolicyGate({
  policy, errors = [], role = "coder", files = [], netLinesAdded = null,
  diffHashValue = null, recordException = () => {},
  standingExceptions = [], now = new Date(),
}) {
  return evaluateGate({
    policy, errors, role, files, netLinesAdded,
    artifactHash: diffHashValue,
    recordException: (entry) => recordException({ ...entry, scope: "este diff exacto" }),
    standingExceptions, now,
  });
}
