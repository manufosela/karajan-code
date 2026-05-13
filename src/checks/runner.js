/**
 * Check runner. Orchestrates the detect → remediate → re-verify phases for
 * a list of Check objects.
 *
 * Phase 1 (detect): executed in parallel with per-check timeout. Timeouts
 * are reported as TIMEOUT status (WARN-level), never throw.
 *
 * Phase 2 (remediate): sequential, only for failures with strategy auto or
 * prompt (and user consent for prompt). Skipped entirely when mode is
 * "check-only". Each remediation has its own timeout (5s default, 60s for
 * prompted actions like npm install).
 *
 * Phase 3 (re-verify): re-runs `detect` once for each check that was
 * remediated, to confirm the fix actually worked. If re-verify fails, the
 * status is FAIL (remediation lied).
 *
 * Runtime overrides returned by remediations are merged into `runReport.overrides`
 * for consumers (e.g. preflight → orchestrator) to apply to the active session.
 */

import { STATUS, STRATEGY } from "./types.js";
import { withTimeout, TimeoutError } from "../utils/with-timeout.js";

const DEFAULT_DETECT_TIMEOUT_MS = 5000;
const DEFAULT_REMEDIATE_TIMEOUT_MS = 60000;

/**
 * @param {import("./types.js").Check[]} checks
 * @param {{ config: Object }} ctx
 * @param {{
 *   mode?: "fix"|"check-only",
 *   yes?: boolean,
 *   onConfirm?: (describe: string) => Promise<boolean>,
 *   timeoutMs?: number,
 *   remediateTimeoutMs?: number,
 *   signal?: AbortSignal,
 *   logger?: { info: Function, warn: Function, error: Function }
 * }} [options]
 * @returns {Promise<import("./types.js").RunReport>}
 */
export async function runChecks(checks, ctx, options = {}) {
  const {
    mode = "fix",
    yes = false,
    onConfirm = defaultOnConfirm,
    timeoutMs = DEFAULT_DETECT_TIMEOUT_MS,
    remediateTimeoutMs = DEFAULT_REMEDIATE_TIMEOUT_MS,
    signal,
    logger = silentLogger(),
  } = options;

  const { config } = ctx;
  const startTotal = Date.now();
  const entries = [];
  const overrides = {};

  // Build applicable entries (skipped checks noted up front).
  // A check.applies(config) may return:
  //   - true / false — boolean form (back-compat).
  //   - an object { applies: boolean, reason?: string } — when false, `reason`
  //     is shown verbatim so users see WHY (e.g. "sonarqube.enabled is false
  //     in kj.config.yml") instead of the opaque "Not applicable" message
  //     that confused users debugging their config.
  for (const check of checks) {
    if (typeof check.applies !== "function") {
      entries.push({ check, status: null, detail: null, runMs: 0, detectResult: null, remediated: false });
      continue;
    }
    const verdict = check.applies(config);
    const isObj = verdict && typeof verdict === "object" && "applies" in verdict;
    const applies = isObj ? Boolean(verdict.applies) : Boolean(verdict);
    if (applies) {
      entries.push({ check, status: null, detail: null, runMs: 0, detectResult: null, remediated: false });
      continue;
    }
    const reason = (isObj && typeof verdict.reason === "string" && verdict.reason.trim())
      ? verdict.reason.trim()
      : "Not applicable for current configuration";
    entries.push({
      check,
      status: STATUS.SKIPPED,
      detail: reason,
      runMs: 0,
      detectResult: null,
      remediated: false,
    });
  }

  // Phase 1: detect in parallel with timeout.
  const detectBase = Date.now();
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.status === STATUS.SKIPPED) return;
      const start = Date.now();
      try {
        const result = await withTimeout(entry.check.detect({ config, signal }), timeoutMs, entry.check.name);
        entry.detectResult = result;
        entry.runMs = Date.now() - start;
        entry.status = resolveStatusFromDetect(entry.check, result);
        entry.detail = result.detail;
        // KJC-BUG-0049: si el check es degradable y falló (status FAIL/WARN tras
        // resolveStatusFromDetect), aplicar disables al overrides y degradar a WARN.
        // Así el preflight no aborta — la feature opcional se desactiva con aviso.
        if (!result.ok && entry.check.degradable && (entry.status === STATUS.FAIL || entry.status === STATUS.WARN)) {
          for (const dotPath of entry.check.degradable.disables || []) {
            setDotPath(overrides, dotPath, false);
          }
          entry.status = STATUS.WARN;
          entry.detail = `${result.detail} → ${entry.check.degradable.warn}`;
          entry.degraded = true;
        }
      } catch (err) {
        entry.runMs = Date.now() - start;
        if (err instanceof TimeoutError) {
          entry.detectResult = { ok: false, severity: "warn", detail: `Timeout after ${timeoutMs}ms` };
          entry.status = STATUS.TIMEOUT;
          entry.detail = entry.detectResult.detail;
        } else {
          entry.detectResult = { ok: false, severity: "fail", detail: `Detection error: ${err.message}` };
          entry.status = STATUS.FAIL;
          entry.detail = entry.detectResult.detail;
        }
      }
    })
  );
  logger.info?.(`Detect phase done in ${Date.now() - detectBase}ms`);

  // Phase 2: remediate sequentially (only in "fix" mode, only failing checks).
  if (mode !== "check-only") {
    for (const entry of entries) {
      if (!shouldAttemptRemediation(entry)) continue;
      const { check, detectResult } = entry;
      if (check.strategy === STRATEGY.PROMPT && !yes) {
        const approved = await onConfirm(check.describe || `Fix: ${check.name}`);
        if (!approved) {
          logger.info?.(`User declined remediation for ${check.name}`);
          continue;
        }
      }
      const start = Date.now();
      try {
        const rem = await withTimeout(
          check.remediate({ config, extra: detectResult.extra, signal, logger }),
          remediateTimeoutMs,
          `${check.name}:remediate`
        );
        entry.remediated = rem.fixed === true;
        entry.runMs += Date.now() - start;
        if (rem.fixed) {
          if (rem.changes) mergeOverrides(overrides, rem.changes);
          entry.detail = rem.detail;
          entry.status = STATUS.FIXED;
        } else {
          entry.detail = rem.detail || entry.detail;
          entry.status = STATUS.FAIL;
        }
      } catch (err) {
        entry.runMs += Date.now() - start;
        const msg = err instanceof TimeoutError ? `Remediation timeout after ${remediateTimeoutMs}ms` : `Remediation error: ${err.message}`;
        entry.detail = msg;
        entry.status = STATUS.FAIL;
        logger.warn?.(`Remediation failed for ${check.name}: ${msg}`);
      }
    }

    // Phase 3: re-verify fixed checks using the config merged with any
    // runtime overrides applied by remediations. Without this merge, a check
    // that rebinds to a new port (override) would re-verify against the old
    // config and wrongly report failure.
    const verifyConfig = mergeConfigAndOverrides(config, overrides);
    await Promise.all(
      entries.filter((e) => e.remediated).map(async (entry) => {
        const start = Date.now();
        try {
          const result = await withTimeout(entry.check.detect({ config: verifyConfig, signal }), timeoutMs, `${entry.check.name}:reverify`);
          entry.runMs += Date.now() - start;
          if (!result.ok) {
            entry.status = STATUS.FAIL;
            entry.detail = `${entry.detail} (but re-verify failed: ${result.detail})`;
          }
        } catch (err) {
          entry.runMs += Date.now() - start;
          entry.status = STATUS.FAIL;
          entry.detail = `${entry.detail} (re-verify error: ${err.message})`;
        }
      })
    );
  }

  // Flatten into reports.
  const reports = entries.map((e) => ({
    name: e.check.name,
    label: e.check.label,
    status: e.status,
    strategy: e.check.strategy,
    detail: e.detail ?? "",
    fix: e.detectResult?.fix,
    runMs: e.runMs,
  }));

  const summary = summarize(reports);

  return {
    checks: reports,
    overrides,
    totalMs: Date.now() - startTotal,
    summary,
  };
}

function shouldAttemptRemediation(entry) {
  if (entry.status === STATUS.SKIPPED) return false;
  if (entry.status === STATUS.OK) return false;
  if (entry.status === STATUS.TIMEOUT) return false; // don't remediate when detect itself timed out
  const { check, detectResult } = entry;
  if (!check.remediate || !detectResult) return false;
  if (check.strategy === STRATEGY.MANUAL || check.strategy === STRATEGY.NONE) return false;
  // Soft failures (WARN) with PROMPT strategy: don't nag the user for optional issues.
  if (entry.status === STATUS.WARN && check.strategy === STRATEGY.PROMPT) return false;
  return true;
}

function resolveStatusFromDetect(check, result) {
  if (result.ok) return STATUS.OK;
  const severity = result.severity || "fail";
  if (severity === "warn") return STATUS.WARN;
  if (severity === "info") return STATUS.OK; // info is always non-failing
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
 * Set a dot-path on a target object, creating intermediate objects as needed.
 * Used by the `degradable` check support (KJC-BUG-0049) to disable feature
 * flags like `git.auto_pr` when their preflight check fails.
 *
 * @example setDotPath({}, "git.auto_pr", false) // → { git: { auto_pr: false } }
 */
function setDotPath(target, dotPath, value) {
  const parts = String(dotPath).split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cursor[k] == null || typeof cursor[k] !== "object") cursor[k] = {};
    cursor = cursor[k];
  }
  cursor[parts.at(-1)] = value;
}

/**
 * Deep-merge (shallow for now, one level deep) remediation changes into overrides.
 * Remediation outputs like { hu_board: { port: 4007 } } should not overwrite a
 * sibling key { hu_board: { enabled: true } } that a prior check set.
 */
function mergeOverrides(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof target[key] === "object") {
      Object.assign(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

/**
 * Produce a shallow-merged copy of config + overrides used during re-verify.
 * Does not mutate the original config.
 */
function mergeConfigAndOverrides(config, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return config;
  const merged = { ...config };
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof config[key] === "object") {
      merged[key] = { ...config[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function defaultOnConfirm() {
  // Non-interactive by default: refuse prompts unless the caller supplies a real handler.
  return Promise.resolve(false);
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

/**
 * Flatten a RunReport into the legacy doctor.js shape.
 * OK/FIXED/SKIPPED → ok:true. WARN/FAIL/TIMEOUT → ok:false.
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
