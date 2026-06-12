/**
 * Golden tasks asserter (KJC-TSK-0374). Parses a `summary.md` produced
 * by a real `kj run` and compares it against a GoldenTask's structural
 * expectations. Pure: no I/O, no subprocess. Subprocess driver lands
 * in PR-3a; the 3 fixtures + baseline + spec land in PR-3b.
 *
 * Three of the five assertion families live here (the ones derivable
 * from summary.md alone): expected_commits_min, expected_audit_status,
 * expected_plan_adherence_min. expected_test_files and
 * allowed_loc_range need filesystem access — PR-3a wires those.
 */

import { escapeRegExp } from "../utils/escape-regexp.js";

const COMMIT_LINE = /^- `([^`]+)`\s+(.*)$/;
const SCORE_LINE = /^\*\*Score\*\*:\s*(\d+)\s*\/\s*100/m;
const AUDIT_ROW = /^\|\s*`audit`\s*\|\s*([^|]+?)\s*\|/m;

function extractSection(content, heading) {
  const re = new RegExp(`^## ${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, "m");
  const m = content.match(re);
  return m ? m[1].trim() : "";
}

function parseCommits(content) {
  const section = extractSection(content, "Commits");
  if (!section || /No commits/.test(section)) return [];
  return section
    .split("\n")
    .map((line) => line.match(COMMIT_LINE))
    .filter(Boolean)
    .map(([, hash, message]) => ({ hash, message }));
}

function parseAuditStatus(content) {
  const m = content.match(AUDIT_ROW);
  if (!m) return null;
  const cell = m[1];
  if (/✅|pass/i.test(cell)) return "pass";
  if (/❌|fail/i.test(cell)) return "fail";
  if (/⚠|warn/i.test(cell)) return "warning";
  return null;
}

function parsePlanAdherence(content) {
  const section = extractSection(content, "Plan adherence");
  if (!section) return null;
  const m = section.match(SCORE_LINE);
  if (!m) return null;
  const score = Number(m[1]);
  return Number.isFinite(score) ? score : null;
}

export function parseSummary(content) {
  const text = String(content || "");
  return {
    commits: parseCommits(text),
    auditStatus: parseAuditStatus(text),
    planAdherenceScore: parsePlanAdherence(text),
  };
}

export function assertFromSummary(task, parsed) {
  const failures = [];

  const fail = (kind, expected, actual, message) => failures.push({ kind, expected, actual, message });

  if (parsed.commits.length < task.expected_commits_min) {
    fail("commits_min", `>= ${task.expected_commits_min}`, parsed.commits.length,
      `expected at least ${task.expected_commits_min} commit(s); got ${parsed.commits.length}`);
  }

  if (parsed.auditStatus !== task.expected_audit_status) {
    const got = parsed.auditStatus === null ? "no audit row in summary" : `"${parsed.auditStatus}"`;
    fail("audit_status", task.expected_audit_status, parsed.auditStatus,
      `expected audit "${task.expected_audit_status}"; got ${got}`);
  }

  if (typeof task.expected_plan_adherence_min === "number") {
    const score = parsed.planAdherenceScore;
    const min = task.expected_plan_adherence_min;
    if (score === null) {
      fail("plan_adherence_missing", `>= ${min}`, null,
        `expected plan adherence >= ${min}; summary has no Plan adherence section`);
    } else if (score < min) {
      fail("plan_adherence_below", `>= ${min}`, score,
        `expected plan adherence >= ${min}; got ${score}`);
    }
  }

  return { ok: failures.length === 0, failures };
}
