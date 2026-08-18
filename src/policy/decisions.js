/**
 * Adaptador del registro de decisiones para karajan-code (GOV-C,
 * KJC-TSK-0747): almacén `.karajan/policy-decisions.jsonl`; policy_hash =
 * sha256 del policy.yml CRUDO (null sin policy — la decisión lo dice, no
 * lo inventa). Append no atómico entre procesos: aceptado, el chokepoint
 * de commit es secuencial.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { recordDecision } from "../../packages/governance/src/decisions.js";

const filePath = (projectDir) => join(projectDir, ".karajan", "policy-decisions.jsonl");

export function policyFileHash(projectDir) {
  try {
    return createHash("sha256").update(readFileSync(join(projectDir, ".karajan", "policy.yml"), "utf8"), "utf8").digest("hex");
  } catch {
    return null;
  }
}

/** @returns {object} the sealed record. */
export function recordGateDecision(projectDir, entry) {
  return recordDecision({
    entry,
    deps: {
      lastLine: () => {
        try {
          const lines = readFileSync(filePath(projectDir), "utf8").split("\n").filter((l) => l.trim());
          return lines.at(-1) ?? null;
        } catch {
          return null;
        }
      },
      append: (line) => {
        mkdirSync(join(projectDir, ".karajan"), { recursive: true });
        appendFileSync(filePath(projectDir), `${line}\n`, "utf8");
      },
    },
  });
}
