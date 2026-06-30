// KJC-TSK-0568 (Onboard A) — maturity classifier for the Brain (`kj start`).
//
// Pure and deterministic: given a bundle of read-only signals it labels the
// project new | existing | legacy. No LLM, no I/O — the sweep (sweep.js) does
// the reading; this only decides. The label drives which read-only subset the
// orchestrator runs and, downstream (0570), whether a deep health pass is worth
// the cost. A user-declared maturity always wins over inference.
//
// Acceptance criteria (KJC-TSK-0568):
//   - empty repo / scaffolding only       -> new
//   - code + config + tests/CI            -> existing
//   - code but missing tests/CI, or very stale -> legacy

/** Last-commit age (days) beyond which a repo counts as stalled/neglected. */
export const STALE_DAYS_THRESHOLD = 365;

const VALID = new Set(["new", "existing", "legacy"]);

/**
 * @param {object} signals
 * @param {("new"|"existing"|"legacy"|null)} [signals.declared] user override
 * @param {boolean} signals.hasSourceCode  real source files present
 * @param {boolean} signals.scaffoldingOnly only generator boilerplate, no real code
 * @param {boolean} signals.hasTests        a test suite is present
 * @param {boolean} signals.hasCI           CI workflows are present
 * @param {number}  [signals.commitCount]   number of commits (capped upstream)
 * @param {number|null} [signals.staleDays] age of the last commit in days
 * @returns {{maturity: "new"|"existing"|"legacy", reasons: string[], deepHealthRecommended: boolean, declared: boolean}}
 */
export function classifyMaturity(signals) {
  if (!signals || typeof signals !== "object") {
    throw new TypeError("classifyMaturity: signals must be an object");
  }

  if (VALID.has(signals.declared)) {
    const maturity = signals.declared;
    return {
      maturity,
      reasons: [`maturity declared by user as "${maturity}"`],
      deepHealthRecommended: maturity === "legacy",
      declared: true,
    };
  }

  const reasons = [];
  let maturity;

  if (!signals.hasSourceCode || signals.scaffoldingOnly) {
    maturity = "new";
    reasons.push(signals.scaffoldingOnly ? "only scaffolding present, no real code yet" : "no source code found");
  } else {
    const stalled = typeof signals.staleDays === "number" && signals.staleDays > STALE_DAYS_THRESHOLD;
    const gaps = [];
    if (!signals.hasTests) gaps.push("no tests");
    if (!signals.hasCI) gaps.push("no CI");
    if (stalled) gaps.push(`last commit ${signals.staleDays}d old (stalled)`);

    if (gaps.length > 0) {
      maturity = "legacy";
      reasons.push(`code present but neglected: ${gaps.join(", ")}`);
    } else {
      maturity = "existing";
      reasons.push("code with tests and CI, actively maintained");
    }
  }

  return {
    maturity,
    reasons,
    deepHealthRecommended: maturity === "legacy",
    declared: false,
  };
}
