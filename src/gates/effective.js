/**
 * KJC-TSK-1387 (ADR 0045): the value every gate applies is its rule's RESOLVED value (what
 * kj.config.yml declares, else what the project says, with skill tightenings). The loader puts
 * it in config.method_gates, which the gates already read, and keeps the declared values in
 * method_gates_declared so `kj gates` can still tell each value's origin.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveRules } from "./registry.js";
import { contributingLayer } from "./contributing.js";
import { detectProjectConventions } from "./project-conventions.js";

/** What the project says: its CONTRIBUTING settings over what is detected, plus conflicts and stale settings. */
export function projectSignals({ projectDir, config, detect = detectProjectConventions,
  readFile = (rel) => readFileSync(path.join(projectDir, rel), "utf8") }) {
  const layer = contributingLayer(config?.contributing_rules, readFile);
  return { project: { ...detect(projectDir), ...layer.project }, conflicts: layer.conflicts, stale: layer.stale };
}

/**
 * Only the rules whose resolved value is not their default are written: a gate that reads
 * `if (mode)` must not start seeing a synthetic default such as mutation "off".
 */
export function applyEffectiveGates(config, projectDir, signals = projectSignals) {
  const { project } = signals({ projectDir, config });
  const methodGates = { ...config.method_gates };
  for (const rule of resolveRules(config, { project }).adjustable) {
    if (rule.origin !== "default") methodGates[rule.key] = rule.value;
  }
  return { ...config, method_gates_declared: config.method_gates, method_gates: methodGates };
}
