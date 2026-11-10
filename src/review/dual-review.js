/**
 * KJC-TSK-1247 (#2623): the dual third-party review. Two reviewers of different families review
 * the same range on their own, and each one's findings are verified by the other family (the
 * --verifier of #2369). This module reconciles both into one result: every finding says who
 * found it and how it was verified, the ones both found rank first, the rejected are listed
 * apart (never dropped), and there is one verdict.
 */
import { summaryOf } from "./review-summary.js";

const RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const rank = (f) => RANK[f.severity] ?? -1;
// Within a few lines of each other in the same file, two reviewers are talking about the same thing.
const NEAR_LINES = 3;
const sameSpot = (a, b) => a.file === b.file
  && (a.line == null || b.line == null ? a.line == null && b.line == null : Math.abs(a.line - b.line) <= NEAR_LINES);
// KJC-BUG-0483 (#3269): code a description names (`backticked`, @scope/package, camelCase). Two
// findings of one category that name the same code are one problem, in whatever file.
const CODE_TERM = /`([^`]+)`|@[\w.-]+\/[\w.-]+|\b[a-z]+[A-Z]\w*/g;
const codeTerms = (f) => new Set([...(f.description ?? "").matchAll(CODE_TERM)].map((m) => (m[1] ?? m[0]).toLowerCase()));
const sameProblem = (a, b) => sameSpot(a, b)
  || ((a.category ?? null) === (b.category ?? null) && !codeTerms(a).isDisjointFrom(codeTerms(b)));
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

const STRENGTH = ["unverified", "downgraded", "kept_by_rule", "confirmed"];
const stronger = (x, y) => (STRENGTH.indexOf(y) > STRENGTH.indexOf(x) ? y : x);
const joinVerification = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])]
  .map((k) => [k, a[k] && b[k] ? stronger(a[k], b[k]) : a[k] ?? b[k]]));

/** One finding per problem: the highest severity leads, the others stay in `also` with who and where. */
function joinGroup(members) {
  const top = members.reduce((x, y) => (rank(y) > rank(x) ? y : x));
  const also = members.filter((m) => m !== top)
    .map((m) => ({ at: where(m), found_by: m.found_by, severity: m.severity, description: m.description }));
  return {
    ...top,
    found_by: [...new Set(members.flatMap((m) => m.found_by))],
    verification: members.map((m) => m.verification).reduce(joinVerification),
    ...(also.length && { also }),
  };
}

/** One list: the same problem, from either reviewer or twice from one, is one finding; both-found rank first. */
function mergeFindings(a, b) {
  const groups = [];
  for (const finding of [...tagged(a), ...tagged(b)]) {
    const group = groups.find((g) => g.some((m) => sameProblem(m, finding)));
    if (group) group.push(finding);
    else groups.push([finding]);
  }
  return groups.map(joinGroup).toSorted((x, y) => y.found_by.length - x.found_by.length || rank(y) - rank(x));
}

function verdictOf(sides, findings, coverage) {
  const blockers = findings.filter((f) => isBlocker(f) && isConfirmed(f));
  // HU-3725 (#3411): one summary of the reconciled result, not the sides' notes joined.
  const summaryFor = (status) => summaryOf({ status, findings, coverage });
  if (blockers.length) return { status: "rejected", approved: false, reason: `confirmed blocker(s): ${blockers.map(where).join(", ")}`, summary: summaryFor("rejected") };
  const rejecting = sides.filter((s) => !s.verdict?.approved).map((s) => s.reviewer);
  if (rejecting.length === 0 && !coverage.truncated) return { status: "approved", approved: true, summary: summaryFor("approved") };
  const dispute = rejecting.length ? `${rejecting.join(" and ")} rejected, but no blocking finding was confirmed by the other family` : null;
  // KJC-BUG-0453 (#2921): "partial" only when files were left out (they are in coverage.unreviewed);
  // everything reviewed and the reviewers disagreeing is "disputed".
  if (coverage.truncated) return { status: "partial", approved: false, reason: ["not every file was reviewed", dispute].filter(Boolean).join("; "), summary: summaryFor("partial") };
  return { status: "disputed", approved: false, reason: dispute, summary: summaryFor("disputed") };
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
