/**
 * KJC-TSK-1388 (ADR 0045): the rules in kj doctor. Silent when everything is in order (one
 * info line); a warning when the project's CONTRIBUTING contradicts a fixed rule or a setting
 * taken from it no longer has its sentence.
 */
import { resolvedWithSignals } from "../gates/summary.js";

export function createRulesCheck({ projectDir }) {
  return {
    name: "rules",
    label: "reglas del método",
    strategy: "manual",
    describe: "The fixed and adjustable rules kj governs with, and what the project says against them",
    async detect({ config } = {}) {
      const { fixed, adjustable, conflicts, stale } = resolvedWithSignals({ config, projectDir });
      const changed = adjustable.filter((r) => r.origin !== "default").length;
      if (conflicts.length === 0 && stale.length === 0) {
        return { ok: true, severity: "info", detail: `${fixed.length} fixed rules, ${adjustable.length} adjustable (${changed} not at their default): kj gates shows them` };
      }
      const lines = [
        ...conflicts.map((c) => `${c.rule} is fixed and ${c.file} says "${c.quote}"`),
        ...stale.map((s) => `${s.rule} → ${s.value} no longer applies: ${s.reason}`),
      ];
      return { ok: false, severity: "warn", detail: lines.join(" · "), fix: "kj gates: a fixed rule stays, so decide whether to use Karajan here; a stale setting needs its sentence back or a new one" };
    },
  };
}
