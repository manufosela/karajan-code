/**
 * `kj check` — verify the quality harness installed by `kj harden`
 * (KJC-TSK-0558). Prints a per-category table and returns an exit code so it
 * works both locally and as a CI drift gate. `--json` for machine output.
 */

import { checkHarden } from "../harden/check.js";
import { collectMethodStats, formatMethodStats } from "../checks/method.js";
import { createRagCoverageCheck } from "../checks/rag-coverage.js";
import { checkAiSurface, formatAiSurface } from "../checks/ai-surface.js";
import { detectObservedAgents } from "../utils/agent-detect.js";
import { loadConfig } from "../config.js";

export async function checkCommand({ projectDir = process.cwd(), profile = "standard", json = false, logger = console } = {}) {
  const result = await checkHarden({ projectDir, profile });
  // KJC-TSK-0689 (MG-D): method adherence is VISIBILITY, not a gate — it
  // rides along in check output but never affects the exit code.
  const method = await collectMethodStats({ projectDir }).catch(() => null);
  // KJC-TSK-0850 (ADR 0010, RAG-D): index coverage IS a gate — an index that
  // exists but misses or lags a source turns check red; no index = the command.
  const { config } = await loadConfig(projectDir).catch(() => ({ config: {} }));
  // An evaluation error (corrupt store, git failure) is a failing check, never
  // a silent pass: the only tolerated non-red state is the explicit "no index".
  const ragCoverage = await createRagCoverageCheck().detect({ config, projectDir }).catch((err) => ({ ok: false, severity: "fail", detail: `rag coverage could not be evaluated: ${err.message}` }));
  // KJC-TSK-0694: same deal for the MCP inventory — a nudge, never a gate.
  // KJC-TSK-0728: observed agent CLIs ride the same snapshot as "(cli)"
  // entries, so a newly-appeared agent binary trips the same drift question.
  let aiSurface = null;
  try {
    const clis = (await detectObservedAgents().catch(() => []))
      .filter((a) => a.available)
      .map((a) => `${a.name} (cli)`);
    aiSurface = checkAiSurface({ projectDir, extraSurface: clis });
  } catch { /* inventory is best-effort */ }

  const ok = result.ok && ragCoverage.ok;
  if (json) {
    logger.info?.(JSON.stringify({ ...result, ok, method, ragCoverage, aiSurface }));
    return ok ? 0 : 1;
  }

  logger.info?.(`kj check (${profile})`);
  for (const c of result.checks) logger.info?.(`  ${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  if (method) logger.info?.(`  method: ${formatMethodStats(method)}`);
  logger.info?.(`  ${ragCoverage.ok ? "✓" : "✗"} rag-coverage: ${ragCoverage.detail}`);
  if (aiSurface) logger.info?.(`  ${formatAiSurface(aiSurface)}`);
  if (ok) logger.info?.("Harness OK.");
  else if (result.ok) logger.info?.("RAG index drift detected — a gate cannot protect what it cannot see.");
  else logger.info?.("Harness drift detected — run `kj harden` to repair.");
  return ok ? 0 : 1;
}
