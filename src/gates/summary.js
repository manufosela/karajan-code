/**
 * KJC-TSK-1388 (ADR 0045): the rules as kj init and kj doctor show them, built from the
 * same registry and project layer as `kj gates`.
 */
import { resolveRules, formatRules } from "./registry.js";
import { projectSignals } from "./effective.js";

/** Every rule resolved, with what the project says against a fixed one and settings gone stale. */
export function resolvedWithSignals({ config, projectDir, signals = projectSignals }) {
  const { project, conflicts, stale } = signals({ projectDir, config });
  return { ...resolveRules(config, { project }), conflicts, stale };
}

/** The lines kj init closes with. */
export function rulesAtClose({ config, projectDir, signals }) {
  return ["", ...formatRules(resolvedWithSignals({ config, projectDir, signals })).split("\n")];
}
