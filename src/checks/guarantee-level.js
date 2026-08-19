/**
 * Guarantee level en runtime (KJC-TSK-0756, hallazgo de campo de Pedro):
 * la doctrina "kj jamás finge una supervisión que no puede aplicar" vivía
 * solo en el README — ahora kj doctor la DECLARA para el host actual, con
 * el porqué. El acoplamiento a Claude es UNA capa (tier A: hooks síncronos
 * bloqueantes, que hoy solo ese harness expone) y es decisión de ADR
 * (v4.13), no accidente; el tier B (git gates) es el suelo agnóstico.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectHostAgent } from "../utils/agent-detect.js";

/** Pure: computes the three tiers from observable facts. */
export function guaranteeLevel({ host, harnessWired, policyDeclared, policyWorkflow }) {
  const tierA = host === "claude" && harnessWired
    ? { active: true, reason: "Claude Code expone hooks síncronos bloqueantes y el harness del Sentinel está instalado (kj harden)" }
    : host === "claude"
      ? { active: false, reason: "host Claude sin harness instalado — corre kj harden para activar la supervisión en el turno" }
      : { active: false, reason: `el host ${host ?? "desconocido"} no expone hooks síncronos bloqueantes — no se finge la supervisión; el tier B sigue siendo el suelo de garantía` };
  const tierB = { active: true, reason: "los gates viven en el repositorio, no en el harness: cualquier host, el diff violador no entra" };
  const tierC = policyDeclared && policyWorkflow
    ? { active: true, reason: "kj-policy.yml re-verifica el PR contra la policy declarada (merge-blocking)" }
    : policyDeclared
      ? { active: false, reason: "hay policy declarada pero sin workflow de CI — corre kj harden para sembrar kj-policy.yml" }
      : { active: false, reason: "sin .karajan/policy.yml declarada — el tier C solo existe donde hay policy que verificar" };
  return { host: host ?? null, tierA, tierB, tierC };
}

/** Facts from disk + env; injectable for tests. */
export function collectGuaranteeFacts({ projectDir = process.cwd(), deps = {} } = {}) {
  const { detectHost = detectHostAgent, exists = existsSync } = deps;
  return guaranteeLevel({
    host: detectHost(),
    harnessWired: exists(join(projectDir, ".karajan", "harness", "pretooluse-sentinel.mjs")),
    policyDeclared: exists(join(projectDir, ".karajan", "policy.yml")),
    policyWorkflow: exists(join(projectDir, ".github", "workflows", "kj-policy.yml")),
  });
}
