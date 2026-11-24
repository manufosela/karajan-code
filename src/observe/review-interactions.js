// HU-4865 (KJC-TSK-1769): coder, reviewer and Solomon interactions counted from the kept verdicts.
import { reviewTruth } from "../report/review-truth.js";

const SAFE_NAME = /^[a-z0-9][a-z0-9:_-]{0,39}$/;

const safeName = (value) => {
  if (value === undefined || value === null) return "unknown";
  return typeof value === "string" && SAFE_NAME.test(value) ? value : "other";
};

function pairRow(author, reviewer, rows) {
  const truth = reviewTruth(rows);
  const own = truth.byReviewer[reviewer];
  const approvals = rows.filter((r) => r.verdict === "approved").length;
  return {
    author, reviewer, verdicts: rows.length, approvals, rejections: rows.length - approvals,
    findings: own?.findings ?? 0, unanchored: own?.unanchored ?? 0,
    correctionRounds: truth.correctionRounds, arbitrations: truth.arbitrations,
  };
}

export function reviewInteractions(records) {
  // Names are cleaned first, so reviewTruth keys its rows by the same name the row carries.
  const cleaned = (records ?? []).filter(Boolean)
    .map((r) => ({ ...r, host: safeName(r.host), reviewer: safeName(r.reviewer) }));
  const pairs = Object.groupBy(cleaned, (r) => JSON.stringify([r.host, r.reviewer]));
  return Object.entries(pairs)
    .map(([key, rows]) => pairRow(...JSON.parse(key), rows))
    .sort((a, b) => a.author.localeCompare(b.author) || a.reviewer.localeCompare(b.reviewer));
}
