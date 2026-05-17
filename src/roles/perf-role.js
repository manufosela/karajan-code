/**
 * PerfRole — webperf quality gate (KJC-TSK-0150).
 *
 * Same shape as SonarRole / AuditRole: extends BaseRole, exposes an
 * `execute()` that returns `{ok, result, summary}`. Internally drives
 * `runWebperfScan` from src/webperf/scanner.js (the Lighthouse wrapper
 * added in KJC-TSK-0149) and persists the result so subsequent
 * `kj audit` runs surface it via `cwv-result` mode (KJC-TSK-0360).
 *
 * Configuration (kj.config.yml):
 *   webperf:
 *     url: http://localhost:3000   # required for the role to run
 *     preset: desktop              # or "mobile"
 *     thresholds: { lcp: { good: 2500, poor: 4000 }, ... }
 *     persist: true                # writes to ~/.karajan/webperf/<slug>/last.json
 *
 * Pipeline activation (KJC-TSK-0151) wires this role behind a triage-
 * driven flag so it only runs for frontend / fullstack tasks.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BaseRole } from "./base-role.js";
import { runWebperfScan } from "../webperf/scanner.js";

function projectSlug(projectDir) {
  return path.basename(projectDir || process.cwd()).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

function defaultPersistDir() {
  return path.join(os.homedir(), ".karajan", "webperf");
}

async function persistResult(result, projectDir) {
  if (!result?.ok) return null;
  const dir = path.join(defaultPersistDir(), projectSlug(projectDir));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "last.json");
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), "utf8");
  return filePath;
}

export class PerfRole extends BaseRole {
  constructor({ config, logger, emitter = null, scanFn = null }) {
    super({ name: "perf", config, logger, emitter });
    // scanFn is injectable for tests so we don't need to mock execFile here.
    this._scan = scanFn || runWebperfScan;
  }

  /**
   * Run a webperf scan against the configured URL.
   *
   * @param {object} [_input] - unused; PerfRole reads its target from config
   * @returns {Promise<{ok: boolean, result: object, summary: string}>}
   */
  async execute(_input) {
    const webperfConfig = this.config?.webperf || {};
    const url = webperfConfig.url;
    const preset = webperfConfig.preset === "mobile" ? "mobile" : "desktop";
    const thresholds = webperfConfig.thresholds || null;
    const persist = webperfConfig.persist !== false;

    if (!url) {
      return {
        ok: false,
        result: { error: "config.webperf.url is required for PerfRole" },
        summary: "PerfRole skipped: no config.webperf.url configured",
      };
    }

    const scan = await this._scan(url, { preset, thresholds, logger: this.logger });

    if (!scan.ok) {
      return {
        ok: false,
        result: {
          url,
          error: scan.reason || "webperf scan failed",
        },
        summary: `Webperf scan failed: ${scan.reason || "unknown"}`,
      };
    }

    let savedPath = null;
    if (persist) {
      try {
        savedPath = await persistResult(scan, this.config?.projectDir);
      } catch (err) {
        if (this.logger?.warn) {
          this.logger.warn(`PerfRole: failed to persist result (non-blocking): ${err.message}`);
        }
      }
    }

    const verdict = scan.cwv?.pass ? "PASS" : "FAIL";
    const score = typeof scan.performanceScore === "number" ? scan.performanceScore : null;
    const blockingMetrics = (scan.cwv?.blocking || []).map(b => `${b.metric.toUpperCase()}=${Math.round(b.value)}`).join(", ");
    const summaryParts = [
      `Webperf ${verdict}`,
      score !== null ? `score ${score}/100` : null,
      blockingMetrics ? `blocking: ${blockingMetrics}` : null,
      `top opportunities: ${scan.issues?.length ?? 0}`,
    ].filter(Boolean);

    return {
      ok: scan.cwv?.pass === true,
      result: {
        url: scan.url,
        preset: scan.preset,
        capturedAt: scan.capturedAt,
        performanceScore: scan.performanceScore,
        metrics: scan.metrics,
        cwv: scan.cwv,
        issues: scan.issues,
        thresholds: scan.thresholds,
        savedPath,
      },
      summary: summaryParts.join(" — "),
    };
  }
}
