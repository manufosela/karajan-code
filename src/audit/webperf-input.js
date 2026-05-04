/**
 * WebPerf input collector for `kj audit` (KJC-TSK-0360).
 *
 * Two modes:
 *   - "static-hints": no live measurement available, but the project is
 *     frontend so the LLM should look for frontend-perf patterns in the
 *     source (bundle bloat, render-blocking, image opt, lazy loading).
 *     This is the common path because `kj audit` runs against a code
 *     tree, not a live preview server.
 *   - "cwv-result": a Core Web Vitals measurement was supplied (either
 *     via config.webperf.lastResult, or in the future via a `kj webperf`
 *     command that drives Chrome DevTools MCP). evaluateCwv from
 *     src/webperf/cwv-gate.js produces a structured verdict the prompt
 *     renders verbatim.
 *
 * The "live measurement" path is intentionally NOT wired here: the
 * audit's LLM sub-agent is forbidden from MCP tool use (SUBAGENT_PREAMBLE
 * in src/prompts/audit.js), and spawning Chrome / launching a preview
 * server during a read-only audit is out of scope. When a future
 * `kj webperf` command exists, it can write the result into
 * `config.webperf.lastResult` and this collector will surface it.
 */

import { evaluateCwv, CWV_THRESHOLDS } from "../webperf/cwv-gate.js";

/**
 * Decide what (if anything) to feed the audit prompt about web perf.
 *
 * @param {object|null} stack - detectProjectStack output (null when unknown)
 * @param {object} [config] - resolved Karajan config (config.webperf may carry a stale CWV result)
 * @returns {{available: boolean, mode?: 'static-hints'|'cwv-result', cwv?: object, reason?: string}}
 */
export function collectWebPerfInput(stack, config = {}) {
  const webperfConfig = config?.webperf || {};
  const lastResult = webperfConfig.lastResult || null;

  if (lastResult && typeof lastResult === "object" && lastResult.metrics) {
    const verdict = evaluateCwv(lastResult.metrics, lastResult.thresholds || webperfConfig.thresholds);
    return {
      available: true,
      mode: "cwv-result",
      url: lastResult.url || webperfConfig.url || null,
      capturedAt: lastResult.capturedAt || null,
      cwv: verdict,
      thresholds: lastResult.thresholds || webperfConfig.thresholds || CWV_THRESHOLDS,
    };
  }

  // No live measurement → static hints only when the project actually has
  // a frontend layer to audit. Backend-only projects get nothing.
  const isFrontendish = !stack || stack.isFrontend === true || stack.isFullstack === true;
  if (!isFrontendish) {
    return { available: false, reason: "project is backend-only — no frontend-perf hints to give" };
  }

  return { available: true, mode: "static-hints" };
}

/**
 * Render a CWV verdict (from collectWebPerfInput's cwv-result mode) as
 * concise prompt-friendly markdown. Kept independent from the prompt
 * builder so it stays unit-testable in isolation.
 */
export function formatCwvVerdict(input) {
  if (!input || input.mode !== "cwv-result" || !input.cwv) return null;
  const { cwv, url, capturedAt } = input;
  const lines = [];
  if (url) lines.push(`- Target URL: ${url}`);
  if (capturedAt) lines.push(`- Captured: ${capturedAt}`);
  lines.push(`- Verdict: ${cwv.pass ? "PASS" : "FAIL"}`);
  if (Object.keys(cwv.scores || {}).length) {
    lines.push("- Scores:");
    for (const [metric, score] of Object.entries(cwv.scores)) {
      lines.push(`  - ${metric.toUpperCase()}: ${score.value} (${score.rating})`);
    }
  }
  if (cwv.blocking?.length) {
    lines.push("- Blocking metrics (above poor threshold):");
    for (const b of cwv.blocking) {
      lines.push(`  - ${b.metric.toUpperCase()} ${b.value} > ${b.threshold}`);
    }
  }
  if (cwv.advisory?.length) {
    lines.push("- Advisory metrics (between good and poor):");
    for (const a of cwv.advisory) {
      lines.push(`  - ${a.metric.toUpperCase()} ${a.value} > good=${a.threshold}`);
    }
  }
  return lines.join("\n");
}
