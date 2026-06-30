// KJC-TSK-0569 (Onboard B) — deterministic synthesis of the read-only sweep.
//
// Turns the sweep bundle (Onboard A, 0568) into one coherent digest: a
// human-readable report plus a machine summary the decider (StartDecidorRole)
// consumes to pick an intent. No LLM here — the costly call is the haiku
// decider, not a redundant strong-model narration. Reuses the harden advisory
// formatter so the improvements section reads exactly like `kj harden --report`.
import { formatAdvisoryReport } from "../harden/advisory.js";

const EMPTY_TALLY = { install: 0, update: 0, review: 0, keep: 0 };

/** Tally harden advisory artifacts by recommendation. */
function tallyImprovements(improvements) {
  const tally = { ...EMPTY_TALLY };
  for (const a of improvements?.artifacts ?? []) {
    if (a?.recommendation in tally) tally[a.recommendation] += 1;
  }
  return tally;
}

/** Quality/maintenance gaps as short phrases, derived from signals + drift. */
function collectGaps(signals = {}, drift) {
  const gaps = [];
  if (!signals.hasTests) gaps.push("no tests");
  if (!signals.hasCI) gaps.push("no CI");
  if (typeof signals.staleDays === "number" && signals.staleDays > 365) {
    gaps.push(`last commit ${signals.staleDays}d old`);
  }
  if (drift && drift.ok === false) {
    const failed = (drift.checks ?? []).filter((c) => c?.ok === false).length;
    if (failed > 0) gaps.push(`${failed} harden check(s) drifting`);
  }
  return gaps;
}

/**
 * @param {object} bundle output of runReadOnlySweep (0568)
 * @returns {{text: string, summary: object}}
 */
export function buildAssessment(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new TypeError("buildAssessment: bundle must be an object");
  }
  const { maturity = {}, signals = {}, drift, improvements, rag, qmd } = bundle;
  const gaps = collectGaps(signals, drift);
  const improvementCounts = tallyImprovements(improvements);

  const summary = {
    maturity: maturity.maturity ?? "unknown",
    declared: Boolean(maturity.declared),
    deepHealthRecommended: Boolean(maturity.deepHealthRecommended),
    gaps,
    driftOk: drift ? drift.ok !== false : null,
    improvementCounts,
    indexed: rag ? Boolean(rag.indexed) : null,
    qmdAvailable: qmd ? Boolean(qmd.available) : null,
  };

  const lines = [
    `Project maturity: ${summary.maturity}${summary.declared ? " (declared)" : " (inferred)"}`,
    ...(maturity.reasons ?? []).map((r) => `  - ${r}`),
    "",
    `Tests: ${signals.hasTests ? "yes" : "no"} · CI: ${signals.hasCI ? "yes" : "no"} · commits: ${signals.commitCount ?? 0}`,
    `Quality gaps: ${gaps.length ? gaps.join(", ") : "none detected"}`,
    `Knowledge index: ${summary.indexed === null ? "n/a" : summary.indexed ? "present" : "missing"}` +
      ` · qmd: ${summary.qmdAvailable === null ? "n/a" : summary.qmdAvailable ? "available" : "absent"}`,
  ];

  if (improvements) {
    lines.push("", ...formatAdvisoryReport(improvements));
  }

  return { text: lines.join("\n"), summary };
}
