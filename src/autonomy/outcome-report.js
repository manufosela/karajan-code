/**
 * outcome-report — the auditable "meets the ask, with known defects" report
 * for an autonomous run (KJC-TSK-0577, design in docs/specs/autonomous-delivery.md §10).
 *
 * Pure: builds a serializable outcome from the run results + Arbiter decisions,
 * and renders it as lines (or the structure is emitted as --json). The point is
 * that an imperfect-but-delivered result is explicit and auditable: which HUs
 * met the ask, what the Arbiter decided, and what debt remains.
 */

/**
 * @param {object} opts
 * @param {string} [opts.planRef]
 * @param {boolean} opts.delivered - the run met the minimum ask
 * @param {Array<{id, title?, met: boolean, note?}>} [opts.hus]
 * @param {Array<{verdict, rationale, hu?, defect?}>} [opts.decisions] - Arbiter log
 */
export function buildOutcome({ planRef = null, delivered = false, hus = [], decisions = [] } = {}) {
  const met = hus.filter((h) => h.met).length;
  const residualDefects = [
    ...hus.filter((h) => !h.met).map((h) => ({ hu: h.id, detail: h.note || "acceptance criteria not fully met" })),
    ...decisions.filter((d) => d.defect).map((d) => ({ hu: d.hu ?? null, detail: d.defect })),
  ];
  return {
    verdict: delivered ? "DELIVERED" : "INCOMPLETE",
    planRef,
    hus: { total: hus.length, met, unmet: hus.length - met },
    decisions,
    residualDefects,
  };
}

/** Render an outcome (from buildOutcome) as human-readable lines. */
export function formatOutcomeReport(outcome) {
  const lines = [
    `kj autorun — outcome: ${outcome.verdict}`,
    `  plan: ${outcome.planRef ?? "?"}`,
    `  HUs:  ${outcome.hus.met}/${outcome.hus.total} met the ask`,
  ];
  if (outcome.decisions?.length) {
    lines.push("  Decisions (Arbiter — least-bad calls):");
    for (const d of outcome.decisions) {
      lines.push(`    • ${d.verdict}${d.hu ? ` [${d.hu}]` : ""} — ${d.rationale}`);
    }
  }
  if (outcome.residualDefects?.length) {
    lines.push("  Known defects (delivered with debt):");
    for (const def of outcome.residualDefects) {
      lines.push(`    • ${def.hu ? `[${def.hu}] ` : ""}${def.detail}`);
    }
  } else {
    lines.push("  No residual defects recorded.");
  }
  return lines;
}
