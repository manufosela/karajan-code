/**
 * Web performance scanner — KJC-TSK-0149.
 *
 * Wraps Google's Lighthouse CLI (`lighthouse`) to produce a structured
 * Core Web Vitals + opportunity report against a local URL. Same
 * pattern as sonar-findings.js, osv-findings.js, semgrep-findings.js:
 * best-effort, missing binary returns {ok:false, reason}, all heavy
 * lifting happens in an external tool the user installs themselves.
 *
 * Output shape is designed to feed two downstream consumers:
 *   1. The CLI `kj webperf <url>` (KJC-TSK-0149) — print JSON or human
 *      report, optionally persist to config.webperf.lastResult.
 *   2. `kj audit` WebPerf section (KJC-TSK-0360) — the `cwv-result` mode
 *      reads exactly this shape from `config.webperf.lastResult`.
 *
 * Lighthouse JSON schema reference:
 *   https://github.com/GoogleChrome/lighthouse/blob/main/types/lhr/lhr.d.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evaluateCwv, CWV_THRESHOLDS } from "./cwv-gate.js";

const execFileAsync = promisify(execFile);

const SCAN_TIMEOUT_MS = 120_000;
const MAX_OPPORTUNITIES = 20;

/**
 * Opportunity audits we extract from Lighthouse output. Each maps to a
 * known render-perf issue with actionable fixes; we keep the list short
 * to bound the payload size and keep the LLM prompt tight when this
 * result feeds `kj audit`.
 */
const OPPORTUNITY_AUDITS = [
  "render-blocking-resources",
  "unused-css-rules",
  "unused-javascript",
  "unminified-css",
  "unminified-javascript",
  "modern-image-formats",
  "uses-optimized-images",
  "uses-text-compression",
  "uses-responsive-images",
  "uses-rel-preconnect",
  "uses-rel-preload",
  "font-display",
  "preload-lcp-image",
  "lcp-lazy-loaded",
  "non-composited-animations",
  "third-party-summary",
  "bootup-time",
  "mainthread-work-breakdown",
];

/**
 * Run Lighthouse against a URL and return a structured result.
 *
 * @param {string} url - target URL (must be reachable from the runner)
 * @param {object} [opts]
 * @param {object} [opts.thresholds] - CWV thresholds override (passed to evaluateCwv)
 * @param {object} [opts.logger]
 * @param {string} [opts.preset] - "desktop" or "mobile" (default: desktop)
 * @param {number} [opts.timeoutMs] - override the 120s default
 * @returns {Promise<object>} scanner result (see module JSDoc)
 */
export async function runWebperfScan(url, opts = {}) {
  if (!url || typeof url !== "string") {
    return { ok: false, reason: "no URL provided" };
  }

  const logger = opts.logger || null;
  const preset = opts.preset === "mobile" ? "mobile" : "desktop";
  const timeoutMs = opts.timeoutMs || SCAN_TIMEOUT_MS;

  const lighthouseArgs = [
    url,
    "--output=json",
    "--quiet",
    "--chrome-flags=--headless --no-sandbox --disable-gpu",
    `--preset=${preset}`,
    "--only-categories=performance",
  ];

  let stdout;
  try {
    const result = await execFileAsync("lighthouse", lighthouseArgs, {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    if (err.code === "ENOENT") {
      if (logger?.warn) logger.warn("lighthouse not found in PATH — install via 'npm install -g lighthouse'");
      return { ok: false, reason: "lighthouse not installed", url };
    }
    if (err.killed) {
      return { ok: false, reason: `lighthouse timed out after ${timeoutMs}ms`, url };
    }
    if (typeof err.stdout === "string" && err.stdout.trim().startsWith("{")) {
      stdout = err.stdout;
    } else {
      const stderr = (err.stderr || "").trim().split("\n").pop() || err.message;
      // Lighthouse prints clear NO_DCHECK / NO_NAVSTART errors when the URL
      // is unreachable. Surface that verbatim.
      const reason = /failed to fetch|connection refused|net::|navigation_start_time/i.test(stderr)
        ? `URL ${url} not reachable: ${stderr}`
        : `lighthouse failed: ${stderr}`;
      if (logger?.warn) logger.warn(reason);
      return { ok: false, reason, url };
    }
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (err) {
    return { ok: false, reason: `lighthouse output not parseable: ${err.message}`, url };
  }

  return parseLighthouseReport(report, { url, preset, thresholds: opts.thresholds });
}

/**
 * Convert a raw Lighthouse JSON report into the scanner's flat output.
 * Public so tests can drive parsing without spawning lighthouse.
 *
 * @param {object} report - parsed Lighthouse output (lhr)
 * @param {{url: string, preset?: string, thresholds?: object}} ctx
 */
export function parseLighthouseReport(report, ctx = {}) {
  const audits = report?.audits || {};
  const metrics = extractMetrics(audits);
  const issues = extractIssues(audits);
  const cwv = evaluateCwv(metrics, ctx.thresholds || CWV_THRESHOLDS);

  return {
    ok: true,
    url: ctx.url || report?.finalDisplayedUrl || report?.requestedUrl || null,
    preset: ctx.preset || "desktop",
    capturedAt: report?.fetchTime || new Date().toISOString(),
    lighthouseVersion: report?.lighthouseVersion || null,
    performanceScore: typeof report?.categories?.performance?.score === "number"
      ? Math.round(report.categories.performance.score * 100)
      : null,
    metrics,
    cwv,
    issues,
    thresholds: ctx.thresholds || CWV_THRESHOLDS,
  };
}

/**
 * Pull Core Web Vitals + supporting metrics out of the Lighthouse audit
 * collection. `numericValue` is the raw measurement Google reports (ms
 * for time-based metrics, score 0-1 for CLS).
 */
function extractMetrics(audits) {
  const get = (id) => {
    const v = audits[id]?.numericValue;
    return typeof v === "number" ? v : null;
  };
  return {
    // CWV — these three drive the cwv-gate verdict
    lcp: get("largest-contentful-paint"),
    cls: get("cumulative-layout-shift"),
    inp: get("interaction-to-next-paint") ?? get("max-potential-fid"),
    // Supporting (informational)
    fcp: get("first-contentful-paint"),
    tbt: get("total-blocking-time"),
    si: get("speed-index"),
    tti: get("interactive"),
  };
}

/**
 * Distil the Lighthouse opportunity audits into a flat `issues` array.
 * Each issue carries the audit id, score, savings (when applicable) and
 * a one-line description so consumers can prioritise without parsing
 * the full lhr.
 */
function extractIssues(audits) {
  const issues = [];
  for (const id of OPPORTUNITY_AUDITS) {
    const audit = audits[id];
    if (!audit) continue;
    // score === 1 means "passed" — skip clean audits
    if (typeof audit.score === "number" && audit.score >= 1) continue;
    if (audit.scoreDisplayMode === "notApplicable") continue;
    issues.push({
      id,
      title: audit.title || id,
      score: typeof audit.score === "number" ? audit.score : null,
      savingsMs: audit.details?.overallSavingsMs ?? null,
      savingsBytes: audit.details?.overallSavingsBytes ?? null,
      severity: scoreToSeverity(audit.score),
    });
  }
  return issues
    .sort((a, b) => (b.savingsMs || 0) - (a.savingsMs || 0))
    .slice(0, MAX_OPPORTUNITIES);
}

function scoreToSeverity(score) {
  if (typeof score !== "number") return "info";
  if (score < 0.5) return "high";
  if (score < 0.9) return "medium";
  return "low";
}
