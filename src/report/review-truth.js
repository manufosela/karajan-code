/**
 * HU-4845 (KJC-TSK-1733, épica KJC-PCS-0113): how truthful the reviews are, from the verdicts kj
 * already keeps in .karajan/reviews: findings that do not anchor per reviewer, correction rounds
 * before an approval, and Solomon's arbitrations by ruling. A rejection saved before the anchoring
 * has no `unanchored` field: it is counted apart as unmeasured, never as anchored.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { GATE_REVIEWERS } from "../review/gate-reviewers.js";

const isGate = (r) => GATE_REVIEWERS.has(r.reviewer);
const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;
const isArbiter = (r) => String(r.reviewer ?? "").startsWith("solomon:");
const byTime = (a, b) => String(a.timestamp).localeCompare(String(b.timestamp));

function reviewerRow(rows) {
  const measured = rows.filter((r) => r.verdict !== "rejected" || Array.isArray(r.unanchored));
  const unanchored = measured.reduce((n, r) => n + (r.unanchored?.length ?? 0), 0);
  const issues = measured.reduce((n, r) => n + (r.issues?.length ?? 0), 0);
  return { findings: issues + unanchored, unanchored, unmeasured: rows.length - measured.length };
}

function arbitrationTally(records) {
  const rulings = records.filter((r) => r.arbitration).map((r) => r.arbitration.ruling);
  return { total: rulings.length, approve: rulings.filter((x) => x === "approve").length, reject: rulings.filter((x) => x === "reject").length };
}

function correctionRounds(records) {
  const rounds = [];
  for (const rows of Object.values(Object.groupBy(records.filter((r) => r.branch && !isGate(r)), (r) => r.branch))) {
    let rejections = 0;
    for (const r of rows.toSorted(byTime)) {
      if (r.verdict === "approved") {
        rounds.push(rejections);
        rejections = 0;
      } else {
        rejections += 1;
      }
    }
  }
  const mean = rounds.length ? round(rounds.reduce((a, b) => a + b, 0) / rounds.length, 2) : 0;
  return { approvals: rounds.length, mean };
}

function gateTally(records) {
  const byGate = {};
  for (const r of records.filter(isGate).toSorted(byTime)) byGate[r.reviewer] = (byGate[r.reviewer] ?? 0) + 1;
  return { total: Object.values(byGate).reduce((a, b) => a + b, 0), byGate };
}

export function reviewTruth(records) {
  const all = (records ?? []).filter(Boolean);
  const byReviewer = {};
  const own = all.filter((r) => r.reviewer && !isArbiter(r) && !isGate(r));
  for (const [reviewer, rows] of Object.entries(Object.groupBy(own, (r) => r.reviewer))) {
    byReviewer[reviewer] = reviewerRow(rows);
  }
  return { verdicts: all.length, byReviewer, arbitrations: arbitrationTally(all), correctionRounds: correctionRounds(all), gates: gateTally(all) };
}

export function formatReviewTruth(truth) {
  const lines = [`Cross-AI review truth (${truth.verdicts} verdicts):`];
  for (const [reviewer, r] of Object.entries(truth.byReviewer)) {
    const share = r.findings ? Math.round((r.unanchored / r.findings) * 100) : 0;
    const old = r.unmeasured ? `, ${r.unmeasured} verdict(s) from before the anchoring not measured` : "";
    lines.push(`  ${reviewer}: ${r.findings} findings, ${r.unanchored} not anchored (${share}%)${old}`);
  }
  const { approvals, mean } = truth.correctionRounds;
  lines.push(`  correction rounds: ${mean} on average over ${approvals} approval(s)`);
  const a = truth.arbitrations;
  lines.push(`  arbitrations: ${a.total} (${a.approve} approve, ${a.reject} reject)`);
  const { total, byGate } = truth.gates;
  const detail = Object.entries(byGate).map(([g, n]) => `${g} ${n}`).join(", ");
  lines.push(`  gate rejections (not reviewers): ${total}${total ? ` (${detail})` : ""}`);
  return lines;
}

export async function reviewTruthReport({ projectDir }) {
  const dir = path.join(projectDir, ".karajan", "reviews");
  const names = await fs.readdir(dir).catch(() => []);
  const records = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    // A report, not a gate: an unreadable verdict file is left out.
    try {
      records.push(JSON.parse(await fs.readFile(path.join(dir, name), "utf8")));
    } catch { /* see above */ }
  }
  return reviewTruth(records);
}
