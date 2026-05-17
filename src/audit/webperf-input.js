/**
 * WebPerf input collector for `kj audit` (KJC-TSK-0360).
 *
 * Two modes:
 *   - "static-hints": no live measurement available, but the project is
 *     frontend so the LLM should look for frontend-perf patterns in the
 *     source (bundle bloat, render-blocking, image opt, lazy loading).
 *     This is the common path because `kj audit` runs against a code
 *     tree, not a live preview server.
 *   - "cwv-result": a Core Web Vitals measurement was supplied. Three
 *     possible sources, in priority order:
 *       1. `config.webperf.lastResult` — inline {metrics, thresholds, ...}
 *          (rare; legacy / programmatic injection)
 *       2. `config.webperf.lastResultPath` — file path written by
 *          `kj webperf` (KJC-TSK-0149). This is the standard wiring.
 *       3. `~/.karajan/webperf/<projectSlug>/last.json` — fallback
 *          discovery when the user ran `kj webperf` but didn't patch
 *          their kj.config.yml.
 *     evaluateCwv from src/webperf/cwv-gate.js produces a structured
 *     verdict the prompt renders verbatim.
 *
 * The "live measurement" path is intentionally NOT wired here: the
 * audit's LLM sub-agent is forbidden from MCP tool use (SUBAGENT_PREAMBLE
 * in src/prompts/audit.js), and spawning Chrome / launching a preview
 * server during a read-only audit is wrong layer. `kj webperf` does
 * the measurement; `kj audit` consumes the persisted result.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { evaluateCwv, CWV_THRESHOLDS } from "../webperf/cwv-gate.js";

// Resolve per call — `os.homedir()` reads $HOME each time, so test
// suites that override $HOME for hermetic tmp dirs work without
// special re-imports.
function webperfHome() {
  return path.join(os.homedir(), ".karajan", "webperf");
}

function projectSlug(projectDir) {
  return path.basename(projectDir || process.cwd()).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Try the three discovery paths in priority order. Returns the parsed
 * scan object (shape produced by src/webperf/scanner.js) or null.
 */
function loadPersistedScan(webperfConfig, projectDir) {
  // 1. Inline result on the config (back-compat)
  if (webperfConfig.lastResult && typeof webperfConfig.lastResult === "object" && webperfConfig.lastResult.metrics) {
    return webperfConfig.lastResult;
  }
  // 2. Explicit file path on the config
  const candidates = [];
  if (webperfConfig.lastResultPath) candidates.push(webperfConfig.lastResultPath);
  // 3. Fallback: ~/.karajan/webperf/<slug>/last.json
  if (projectDir) {
    candidates.push(path.join(webperfHome(), projectSlug(projectDir), "last.json"));
  }
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.metrics) return parsed;
    } catch { /* missing file or unparseable — try next */ }
  }
  return null;
}

/**
 * Decide what (if anything) to feed the audit prompt about web perf.
 *
 * @param {object|null} stack - detectProjectStack output (null when unknown)
 * @param {object} [config] - resolved Karajan config (config.webperf may carry a stale CWV result)
 * @returns {{available: boolean, mode?: 'static-hints'|'cwv-result', cwv?: object, reason?: string}}
 */
export function collectWebPerfInput(stack, config = {}) {
  const webperfConfig = config?.webperf || {};
  const projectDir = config?.projectDir;
  const persisted = loadPersistedScan(webperfConfig, projectDir);

  if (persisted) {
    const verdict = persisted.cwv || evaluateCwv(persisted.metrics, persisted.thresholds || webperfConfig.thresholds);
    return {
      available: true,
      mode: "cwv-result",
      url: persisted.url || webperfConfig.url || null,
      capturedAt: persisted.capturedAt || null,
      cwv: verdict,
      thresholds: persisted.thresholds || webperfConfig.thresholds || CWV_THRESHOLDS,
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
