/**
 * `kj webperf <url>` — KJC-TSK-0149.
 *
 * Headless Lighthouse wrapper. Produces structured CWV + opportunities
 * JSON. Writes the result into `~/.karajan/webperf/<projectSlug>/last.json`
 * so future `kj audit` runs can surface the verdict via the existing
 * WebPerf section (KJC-TSK-0360 cwv-result mode).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { runWebperfScan } from "../webperf/scanner.js";
import { withCliRunLog } from "../utils/cli-run-log.js";

// Delegated to src/utils/paths.js (KJC-TSK-0420) — respects
// KARAJAN_HOME / KJ_HOME / VITEST tmp / default.
import { getWebperfDir } from "../utils/paths.js";
function defaultReportDir() { return getWebperfDir(); }

/**
 * Slug a project directory the same way audit/basal-cost.js and
 * plan/plan-store.js do, so the per-project webperf history aligns
 * with audit history under ~/.karajan/.
 */
function projectSlug(projectDir) {
  return path.basename(projectDir || process.cwd()).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

function formatHumanReport(result) {
  if (!result.ok) {
    return `WebPerf scan FAILED — ${result.reason}`;
  }
  const lines = ["## WebPerf Scan", ""];
  lines.push(`- URL: ${result.url}`);
  lines.push(`- Preset: ${result.preset}`);
  lines.push(`- Captured: ${result.capturedAt}`);
  if (result.lighthouseVersion) lines.push(`- Lighthouse: v${result.lighthouseVersion}`);
  if (typeof result.performanceScore === "number") {
    lines.push(`- Performance score: ${result.performanceScore}/100`);
  }
  lines.push("");
  lines.push(`### Verdict: ${result.cwv.pass ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push("### Core Web Vitals");
  for (const [metric, score] of Object.entries(result.cwv.scores || {})) {
    const value = formatMetricValue(metric, score.value);
    lines.push(`- ${metric.toUpperCase()}: ${value} (${score.rating})`);
  }
  if (result.cwv.blocking?.length) {
    lines.push("");
    lines.push("### Blocking metrics (above poor threshold)");
    for (const b of result.cwv.blocking) {
      lines.push(`- ${b.metric.toUpperCase()}: ${formatMetricValue(b.metric, b.value)} > ${formatMetricValue(b.metric, b.threshold)}`);
    }
  }
  if (result.issues?.length) {
    lines.push("");
    lines.push(`### Top opportunities (${result.issues.length})`);
    for (const issue of result.issues.slice(0, 10)) {
      const savings = issue.savingsMs ? ` (saves ~${Math.round(issue.savingsMs)}ms)` : "";
      lines.push(`- [${issue.severity.toUpperCase()}] ${issue.id}${savings}: ${issue.title}`);
    }
    if (result.issues.length > 10) {
      lines.push(`- ... and ${result.issues.length - 10} more`);
    }
  }
  return lines.join("\n");
}

function formatMetricValue(metric, value) {
  if (typeof value !== "number") return "n/a";
  if (metric === "cls") return value.toFixed(3);
  return `${Math.round(value)}ms`;
}

/**
 * Persist the scan result into ~/.karajan/webperf/<slug>/last.json so
 * `kj audit` can read it via collectWebPerfInput (KJC-TSK-0360).
 */
async function persistResult(result, projectDir) {
  if (!result.ok) return null;
  const dir = path.join(defaultReportDir(), projectSlug(projectDir));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "last.json");
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), "utf8");
  return filePath;
}

/**
 * Optionally update kj.config.yml so `kj audit` finds the result by
 * default (mirrors how sonar config is wired). Best-effort: never
 * fails the command; absence of config file or write error is logged.
 */
async function patchConfigLastResult(configPath, lastResultPath, logger) {
  if (!configPath || !lastResultPath) return false;
  let raw;
  try { raw = await fs.readFile(configPath, "utf8"); } catch { return false; }
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch (err) {
    if (logger?.warn) logger.warn(`webperf: cannot parse ${configPath}: ${err.message}`);
    return false;
  }
  parsed.webperf = parsed.webperf || {};
  parsed.webperf.lastResultPath = lastResultPath;
  try {
    await fs.writeFile(configPath, yaml.dump(parsed), "utf8");
    return true;
  } catch (err) {
    if (logger?.warn) logger.warn(`webperf: cannot write ${configPath}: ${err.message}`);
    return false;
  }
}

export async function webperfCommand({ url, config, logger, json = false, mobile = false, persist = true, thresholds = null }) {
  if (!url) {
    throw new Error("kj webperf: <url> is required (e.g. http://localhost:3000)");
  }
  return withCliRunLog("webperf", { projectDir: config?.projectDir, logger }, async ({ runLog }) => {
    logger.info(`Running webperf scan against ${url} (preset: ${mobile ? "mobile" : "desktop"})`);
    runLog.logText(`[webperf] scan url=${url} preset=${mobile ? "mobile" : "desktop"}`);

    const scanThresholds = thresholds || config?.webperf?.thresholds || null;
    const result = await runWebperfScan(url, {
      preset: mobile ? "mobile" : "desktop",
      thresholds: scanThresholds,
      logger,
    });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatHumanReport(result));
    }

    if (!result.ok) {
      runLog.logText(`[webperf] failed reason=${result.reason}`);
      return { ok: false, reason: result.reason };
    }

    runLog.logText(`[webperf] verdict=${result.cwv.pass ? "PASS" : "FAIL"} score=${result.performanceScore}`);

    let savedPath = null;
    if (persist) {
      try {
        savedPath = await persistResult(result, config?.projectDir);
        if (savedPath) {
          logger.info(`WebPerf result saved: ${savedPath}`);
          // Wire into kj.config.yml so `kj audit` picks it up automatically.
          const configPath = config?.configFilePath
            || path.join(config?.projectDir || process.cwd(), ".karajan", "kj.config.yml");
          await patchConfigLastResult(configPath, savedPath, logger);
        }
      } catch (err) {
        logger.warn(`webperf: persist failed (non-blocking): ${err.message}`);
      }
    }

    // Exit code: 0 for PASS, 1 for FAIL. Lets CI gate on it.
    return { ok: result.cwv.pass, result, savedPath };
  });
}
