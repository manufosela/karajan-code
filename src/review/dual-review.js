/**
 * KJC-TSK-1247 (#2623): the dual third-party review. Two reviewers of different families review
 * the same range on their own, and each one's findings are verified by the other family (the
 * --verifier of #2369). This module reconciles both into one result: every finding says who
 * found it and how it was verified, the ones both found rank first, the rejected are listed
 * apart (never dropped), and there is one verdict.
 */

const RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const rank = (f) => RANK[f.severity] ?? -1;
// Within a few lines of each other in the same file, two reviewers are talking about the same thing.
const NEAR_LINES = 3;
const sameSpot = (a, b) => a.file === b.file
  && (a.line == null || b.line == null ? a.line == null && b.line == null : Math.abs(a.line - b.line) <= NEAR_LINES);
const isBlocker = (f) => f.category === "security" || rank(f) >= RANK.high;
// Security is never overridable; otherwise the other family confirmed it, or both reviewers found it.
const isConfirmed = (f) => f.category === "security" || f.found_by.length === 2
  || Object.values(f.verification).some((o) => o === "confirmed" || o === "kept_by_rule");
const where = (f) => `${f.file ?? "?"}:${f.line ?? "?"}`;

/** Each side's kept findings, tagged with who found them and how the other family judged them. */
function tagged(side) {
  const verifier = side.verification?.verifier;
  return side.findings.map((finding, i) => ({
    ...finding,
    found_by: [side.reviewer],
    verification: verifier ? { [verifier]: side.outcomes?.[i] ?? "unverified" } : {},
  }));
}

/** One list: a finding both reviewers made is merged (the higher severity wins) and ranks first. */
function mergeFindings(a, b) {
  const rest = tagged(b);
  const merged = tagged(a).map((fa) => {
    const at = rest.findIndex((fb) => sameSpot(fa, fb));
    if (at < 0) return fa;
    const [fb] = rest.splice(at, 1);
    const top = rank(fb) > rank(fa) ? fb : fa;
    return { ...top, found_by: [...fa.found_by, ...fb.found_by], verification: { ...fa.verification, ...fb.verification } };
  });
  return [...merged, ...rest].toSorted((x, y) => y.found_by.length - x.found_by.length || rank(y) - rank(x));
}

function verdictOf(sides, findings, coverage) {
  const blockers = findings.filter((f) => isBlocker(f) && isConfirmed(f));
  const summary = sides.map((s) => s.verdict?.summary).filter(Boolean).join("\n");
  if (blockers.length) return { status: "rejected", approved: false, reason: `confirmed blocker(s): ${blockers.map(where).join(", ")}`, summary };
  const rejecting = sides.filter((s) => !s.verdict?.approved).map((s) => s.reviewer);
  if (rejecting.length === 0 && !coverage.truncated) return { status: "approved", approved: true, summary };
  const reason = rejecting.length
    ? `${rejecting.join(" and ")} rejected, but no blocking finding was confirmed by the other family`
    : "not every file was reviewed";
  return { status: "partial", approved: false, reason, summary };
}

/** The two sides (reviewer, model, verdict, coverage, findings, outcomes, verification) as one result. */
export function reconcileReviews([a, b]) {
  const findings = mergeFindings(a, b);
  const coverage = { ...a.coverage, truncated: Boolean(a.coverage?.truncated || b.coverage?.truncated) };
  const counts = ({ reviewer, verification: v = {} }) => ({
    reviewer, verifier: v.verifier ?? null, confirmed: v.confirmed ?? 0, downgraded: v.downgraded ?? 0,
    unverified: v.unverified ?? 0, kept_by_rule: v.kept_by_rule ?? 0, ...(v.error && { error: v.error }),
  });
  const rejected = [a, b].flatMap((s) => (s.verification?.rejected ?? [])
    .map((r) => ({ ...r, found_by: s.reviewer, rejected_by: s.verification.verifier })));
  return {
    reviewers: [a, b].map((s) => ({ reviewer: s.reviewer, model: s.model ?? null, verdict: s.verdict })),
    verdict: verdictOf([a, b], findings, coverage),
    coverage,
    findings,
    verification: { by: [a, b].map(counts), rejected },
  };
}
