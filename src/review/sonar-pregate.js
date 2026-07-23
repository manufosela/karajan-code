/**
 * Sonar pre-gate for `kj review --staged` (KJC-TSK-0676, user request
 * 2026-07-23). With the brain outside the core (v4), skipping sonar is one
 * decision away — proven the day the brain itself shipped 3 sonar issues in
 * new code. Hung off the review gate, it becomes a gate, not discipline:
 * deterministic findings on the STAGED files come back before any AI
 * verdict, and BLOCKER/CRITICAL ones reject without spending reviewer
 * tokens. Unavailable sonar degrades loudly ({available:false, reason}) —
 * a laptop without Docker still commits.
 */

import { runSonarScan } from "../sonar/scanner.js";
import { getOpenIssues } from "../sonar/api.js";
import { acquireToolLock } from "../utils/tool-governor.js";

const BLOCKING_SEVERITIES = new Set(["BLOCKER", "CRITICAL"]);

/** Repo-relative path of a sonar issue (component is "<projectKey>:<path>"). */
export function issueFile(issue) {
  const component = String(issue?.component || "");
  const idx = component.indexOf(":");
  return idx === -1 ? component : component.slice(idx + 1);
}

/** One printable line per finding: (SEVERITY) [file:line] rule — message. */
export function formatSonarFinding(issue) {
  const line = issue.line ? `:${issue.line}` : "";
  return `(${issue.severity}) [${issueFile(issue)}${line}] ${issue.rule} — ${issue.message}`;
}

/**
 * Scan the project (single-flight via the tool governor) and return the
 * open issues that live on the staged files, split by blocking severity.
 * Every failure path degrades to {available:false, reason} — the pre-gate
 * never breaks the review, it only refuses to stay silent.
 */
export async function runSonarPregate({ config, stagedFiles = [], logger = null }) {
  if (config?.review_gate?.sonar === false) {
    return { available: false, reason: "disabled in config (review_gate.sonar: false)" };
  }
  let lock = null;
  try {
    lock = await acquireToolLock("sonar-scanner", { timeoutMs: 300_000 });
    const scan = await runSonarScan(config);
    if (!scan.ok) {
      return { available: false, reason: (scan.stderr || scan.stdout || "sonar scan failed").trim() };
    }
    const res = await getOpenIssues(config, scan.projectKey);
    const staged = new Set(stagedFiles);
    const onStaged = (res.issues || []).filter((i) => staged.has(issueFile(i)));
    return {
      available: true,
      blocking: onStaged.filter((i) => BLOCKING_SEVERITIES.has(String(i.severity).toUpperCase())),
      advisory: onStaged.filter((i) => !BLOCKING_SEVERITIES.has(String(i.severity).toUpperCase())),
      totalProject: res.total ?? (res.issues || []).length,
    };
  } catch (err) {
    logger?.warn?.(`[sonar-pregate] ${err.message}`);
    return { available: false, reason: err.message };
  } finally {
    lock?.release?.();
  }
}
