/**
 * Sonar findings collector for `kj audit` (KJC-TSK-0361).
 *
 * The audit pipeline already pays for SonarQube to exist (kj run + the
 * SonarStage drive a full scan and gate the pipeline on its result). When
 * the user runs `kj audit`, we don't want to pay for *another* full scan
 * (~1-3 min) — we want to read whatever Sonar already knows. This module
 * does exactly that: ping the configured Sonar host, and if it's
 * reachable, fetch the current open-issue list + quality-gate status via
 * the existing sonar/api.js helpers. Both results are best-effort: a
 * sonar-down host or a never-scanned project quietly returns
 * `{available: false, reason: "..."}` and the audit continues without
 * the section.
 *
 * Why this matters: the LLM auditor was previously asked to find issues
 * by reading source code, but Sonar already produces them with rule IDs
 * (squid:S1234), severity, and line precision. Feeding those in lets the
 * LLM cross-reference its own findings (high-confidence overlap) and
 * focus its tokens on patterns Sonar can't see (architecture, naming,
 * API design).
 */

import { isSonarReachable } from "../sonar/manager.js";
import { getOpenIssues, getQualityGateStatus } from "../sonar/api.js";

/**
 * Collect deterministic Sonar findings for the audit prompt.
 *
 * @param {object} config - resolved Karajan config (must have config.sonarqube.host)
 * @param {object} [logger] - optional logger for warn-level traces
 * @returns {Promise<{available: boolean, reason?: string, issues?: object[], total?: number, qualityGate?: object}>}
 */
export async function collectSonarFindings(config, logger = null) {
  const sonarConfig = config?.sonarqube || {};
  const host = sonarConfig.host || "http://localhost:9000";
  const healthcheckSeconds = sonarConfig.timeouts?.healthcheckSeconds ?? 5;

  // Ping first — avoids surfacing a 30-second timeout into audit runtime
  // when Docker is simply down or the user opted out of Sonar.
  const reachable = await isSonarReachable(host, healthcheckSeconds).catch(() => false);
  if (!reachable) {
    if (logger?.warn) logger.warn(`sonar audit input skipped: host ${host} not reachable`);
    return { available: false, reason: `sonar host ${host} not reachable` };
  }

  let issuesResult;
  try {
    issuesResult = await getOpenIssues(config);
  } catch (err) {
    if (logger?.warn) logger.warn(`sonar audit input: getOpenIssues failed: ${err?.message || err}`);
    return { available: false, reason: `getOpenIssues failed: ${err?.message || err}` };
  }

  let qualityGate = null;
  try {
    const qg = await getQualityGateStatus(config);
    if (qg?.ok) qualityGate = { status: qg.status, conditions: qg.conditions };
  } catch { /* gate is optional context */ }

  return {
    available: true,
    issues: issuesResult.issues || [],
    total: issuesResult.total || 0,
    qualityGate,
  };
}

/**
 * Group Sonar issues by severity, preserving Sonar's canonical ordering.
 * Used by the prompt builder to render the findings section.
 */
export function groupIssuesBySeverity(issues) {
  const order = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
  const groups = Object.fromEntries(order.map(s => [s, []]));
  for (const issue of issues || []) {
    const sev = issue.severity || "INFO";
    if (groups[sev]) groups[sev].push(issue);
    else groups.INFO.push(issue);
  }
  return groups;
}
