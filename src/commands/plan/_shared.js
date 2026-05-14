// ---- Formatting helpers shared across plan sub-commands ----

export function formatPlan(plan) {
  const lines = [];
  if (plan.approach) lines.push("## Approach", plan.approach, "");
  if (plan.steps?.length) {
    lines.push("## Steps");
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const commit = step.commit ? ` → \`${step.commit}\`` : "";
      lines.push(`${i + 1}. ${step.description}${commit}`);
    }
    lines.push("");
  }
  if (plan.risks?.length) {
    lines.push("## Risks");
    for (const risk of plan.risks) lines.push(`- ${risk}`);
    lines.push("");
  }
  if (plan.outOfScope?.length) {
    lines.push("## Out of scope");
    for (const item of plan.outOfScope) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Convierte el id largo de una dep `hu_<planId>_<NNN>` al short_id de
 * la HU correspondiente cuando lo conoce. Mantiene el id largo si la
 * dep no tiene short_id (HU legacy pre-humanización).
 */
function displayDep(depId, hus) {
  const hu = hus.find((h) => h.id === depId);
  if (hu?.short_id) return hu.short_id;
  return depId;
}

export function formatHuTable(hus) {
  if (!hus?.length) return "  (no HUs)";
  // Humanización IDs: si la HU tiene short_id ("INFRA-001"), úsalo
  // como columna ID; si no, fallback al id largo (HU legacy).
  const idOf = (h) => h.short_id || h.id;
  const lines = [];
  const maxId = Math.min(20, Math.max(...hus.map((h) => idOf(h).length || 0)));
  const maxTitle = Math.min(50, Math.max(...hus.map(h => h.title?.length || 0)));
  lines.push(`  ${"ID".padEnd(maxId)} ${"Title".padEnd(maxTitle)} ${"Type".padEnd(10)} ${"Status".padEnd(10)} Deps`);
  lines.push(`  ${"─".repeat(maxId)} ${"─".repeat(maxTitle)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(15)}`);
  for (const hu of hus) {
    const title = (hu.title || "").slice(0, maxTitle).padEnd(maxTitle);
    const deps = (hu.blocked_by || []).map((d) => displayDep(d, hus)).join(", ") || "—";
    lines.push(`  ${idOf(hu).padEnd(maxId)} ${title} ${(hu.task_type || "sw").padEnd(10)} ${(hu.status || "?").padEnd(10)} ${deps}`);
  }
  return lines.join("\n");
}
