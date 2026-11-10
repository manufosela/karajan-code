/**
 * HU-3725 (#3411): the one summary of a third-party review, built from the reconciled result
 * (status, findings, coverage) with no model call, so it can never contradict them. The notes
 * each batch's reviewer wrote travel apart, in `batches[]`.
 */

const RANK = { critical: 3, high: 2, medium: 1, low: 0 };
const TOP = 3;
const CLIP = 100;

const clip = (s) => (s.length > CLIP ? `${s.slice(0, CLIP - 1)}…` : s);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const top = ({ severity, file, line, description }) => `[${severity ?? "unrated"}] ${file ?? "?"}:${line ?? "?"} ${clip(String(description ?? "").replace(/\s+/g, " ").trim())}`;

/** One short line: the verdict, how many findings and the worst ones; "no findings" only when there are none. */
export function summaryOf({ status, findings, coverage }) {
  const { reviewed, total } = coverage?.files ?? {};
  const scope = total ? ` (${reviewed} of ${total} files reviewed)` : "";
  if (!findings.length) {
    return status === "approved" ? `Approved with no findings${scope}.` : `${status}: no itemised findings${scope}.`;
  }
  const worst = findings.toSorted((a, b) => (RANK[b.severity] ?? -1) - (RANK[a.severity] ?? -1)).slice(0, TOP);
  return `${status}: ${plural(findings.length, "finding")}${scope}. Top: ${worst.map(top).join("; ")}`;
}

/** What each batch's reviewer said, kept next to the verdict instead of inside it. */
export const batchNotes = (reviewer, records) => records.map((r, i) => ({ batch: i + 1, reviewer, verdict: r.verdict, summary: r.summary ?? "" }));
