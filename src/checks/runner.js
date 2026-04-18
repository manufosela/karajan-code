/**
 * Check runner. Orchestrates the detect → remediate → re-verify phases for
 * a list of Check objects. Commit 1 implements only the detect phase (parallel
 * execution, applies filter, timeout-free for now). Later commits add
 * remediation, timeout wrapping, and re-verify.
 *
 * API contract intentionally leaves space for extension without breaking
 * consumers: options bag is always the last argument and backwards-compat
 * is preserved when unknown fields are added.
 */

import { STATUS, STRATEGY } from "./types.js";

/**
 * Execute a list of checks and return a structured report.
 *
 * @param {import("./types.js").Check[]} checks
 * @param {{ config: Object }} ctx
 * @param {{
 *   mode?: "fix"|"check-only",
 *   yes?: boolean,
 *   onConfirm?: (describe: string) => Promise<boolean>,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 *   logger?: { info: Function, warn: Function, error: Function }
 * }} [options]
 * @returns {Promise<import("./types.js").RunReport>}
 */
export async function runChecks(checks, ctx, options = {}) {
  const { config } = ctx;
  const startTotal = Date.now();

  const reports = [];

  // Build applicable checks (skipped checks get a SKIPPED report).
  const applicable = [];
  for (const check of checks) {
    if (typeof check.applies === "function" && !check.applies(config)) {
      reports.push({
        name: check.name,
        label: check.label,
        status: STATUS.SKIPPED,
        strategy: check.strategy,
        detail: "Not applicable for current configuration",
        runMs: 0,
      });
      continue;
    }
    applicable.push(check);
  }

  // Phase 1: detect in parallel.
  const detections = await Promise.all(
    applicable.map(async (check) => {
      const start = Date.now();
      try {
        const result = await check.detect({ config });
        return { check, result, runMs: Date.now() - start, error: null };
      } catch (err) {
        return {
          check,
          result: { ok: false, severity: "fail", detail: `Detection error: ${err.message}` },
          runMs: Date.now() - start,
          error: err,
        };
      }
    })
  );

  // Build reports. Remediation will be added in commit 4.
  for (const { check, result, runMs } of detections) {
    const status = resolveStatus(check, result);
    reports.push({
      name: check.name,
      label: check.label,
      status,
      strategy: check.strategy,
      detail: result.detail,
      fix: result.fix,
      runMs,
    });
  }

  const summary = summarize(reports);

  return {
    checks: reports,
    overrides: {},
    totalMs: Date.now() - startTotal,
    summary,
  };
}

function resolveStatus(check, result) {
  if (result.ok) return STATUS.OK;
  const severity = result.severity || "fail";
  if (severity === "warn") return STATUS.WARN;
  if (severity === "info") return STATUS.OK; // info always OK
  // strategy "none" checks should never fail; treat as WARN defensively
  if (check.strategy === STRATEGY.NONE) return STATUS.WARN;
  return STATUS.FAIL;
}

function summarize(reports) {
  const summary = { ok: 0, fixed: 0, warn: 0, fail: 0, skipped: 0, timeout: 0 };
  for (const r of reports) {
    const k = r.status.toLowerCase();
    if (k in summary) summary[k]++;
  }
  return summary;
}

/**
 * Flatten a RunReport into the legacy doctor.js shape for backwards compat
 * with existing tests and consumers that still expect {name,label,ok,detail,fix}.
 */
export function toLegacyShape(runReport) {
  return runReport.checks.map((c) => ({
    name: c.name,
    label: c.label,
    ok: c.status === STATUS.OK || c.status === STATUS.FIXED || c.status === STATUS.SKIPPED,
    detail: c.detail,
    fix: c.fix ?? null,
  }));
}
