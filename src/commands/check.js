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
import { panelSummary } from "../environment/panel.js";
import { loadConfig } from "../config.js";
import { branchCooldownLines } from "../checks/supply-chain-check.js";
import { auditCycle } from "../checks/audit-cycle.js";

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
  const aiSurface = await observedAiSurface(projectDir);

  // KJC-TSK-1059: young dependencies the branch brings in, a warning outside the review.
  const depCooldown = await branchCooldownLines({ projectDir, base: config?.base_branch ?? "main", thresholdHours: config?.supply_chain?.cooldown_hours })
    .catch((err) => [`⚠ supply-chain cooldown not checked: ${err.message}`]);
  // KJC-TSK-0719 (SPD-C): the audit is due by work cycles too; visibility, never the exit code.
  const audit = await auditCycle({ projectDir, config }).catch((err) => ({ due: false, line: `⚠ audit cycle not checked: ${err.message}` }));

  const ok = result.ok && ragCoverage.ok;
  if (json) {
    logger.info?.(JSON.stringify({ ...result, ok, method, ragCoverage, aiSurface, depCooldown, auditCycle: audit }));
    return ok ? 0 : 1;
  }

  printReport({ profile, result, method, ragCoverage, aiSurface, depCooldown, audit, config, ok, logger });
  return ok ? 0 : 1;
}

// KJC-TSK-0694: same deal for the MCP inventory — a nudge, never a gate.
// KJC-TSK-0728: observed agent CLIs ride the same snapshot as "(cli)"
// entries, so a newly-appeared agent binary trips the same drift question.
async function observedAiSurface(projectDir) {
  try {
    const clis = (await detectObservedAgents().catch(() => []))
      .filter((a) => a.available)
      .map((a) => `${a.name} (cli)`);
    return checkAiSurface({ projectDir, extraSurface: clis });
  } catch { return null; /* inventory is best-effort */ }
}

const mark = (ok) => (ok ? "✓" : "✗");

function verdictLine(ok, harnessOk) {
  if (ok) return "Harness OK.";
  if (harnessOk) return "RAG index drift detected — a gate cannot protect what it cannot see.";
  return "Harness drift detected — run `kj harden` to repair.";
}

function printReport({ profile, result, method, ragCoverage, aiSurface, depCooldown, audit, config, ok, logger }) {
  logger.info?.(`kj check (${profile})`);
  for (const c of result.checks) logger.info?.(`  ${mark(c.ok)} ${c.id}: ${c.detail}`);
  if (method) logger.info?.(`  method: ${formatMethodStats(method)}`);
  logger.info?.(`  ${mark(ragCoverage.ok)} rag-coverage: ${ragCoverage.detail}`);
  if (aiSurface) logger.info?.(`  ${formatAiSurface(aiSurface)}`);
  for (const line of depCooldown) logger.info?.(`  ${line}`);
  logger.info?.(`  ${audit.line}`);
  // KJC-TSK-0865: who writes and who reviews is the user's choice, so it is
  // said out loud next to everything else that describes the project. Never
  // a check: it has no ok/fail, it informs.
  logger.info?.(`  ${panelSummary(config)}`);
  logger.info?.(verdictLine(ok, result.ok));
}
