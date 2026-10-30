/**
 * Direct role handler logic (code, audit, discover). KJC-TSK-1318: review,
 * plan, triage, researcher and architect left with the kj run pipeline.
 */

import fs from "node:fs/promises";
import { resolveRole } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import { assertAgentsAvailable } from "../../agents/availability.js";
import { createAgent } from "../../agents/index.js";
import { buildCoderPrompt } from "../../prompts/coder.js";
import { createRunLog } from "../../utils/run-log.js";
import { createStallDetector } from "../../utils/stall-detector.js";
import { sendTrackerLog } from "../progress.js";
import { runDirectRole } from "../direct-role-runner.js";
import { isPreflightAcked, ackPreflight, getSessionOverrides } from "../preflight.js";
import { ensureBootstrap } from "../../bootstrap.js";
import { loadConfig } from "../../config.js";
import {
  resolveProjectDir,
  failPayload,
  assertNotOnBaseBranch,
  buildConfig,
  buildDirectEmitter,
  ensureTaskFromFile,
} from "../shared-helpers.js";

/**
 * Run bootstrap gate: validate all environment prerequisites before execution.
 */
async function runBootstrapGate(server, a) {
  const projectDir = await resolveProjectDir(server, a.projectDir);
  const { config } = await loadConfig(projectDir);
  await ensureBootstrap(projectDir, config);
}

/**
 * KJC-BUG-0175 (#1723): the tool schemas promise "either `task` or
 * `taskFile`", but only kj_run read the file — every direct handler
 * answered "Missing required field: task" to a taskFile-only call. Same
 * resolution as run-handler: read the file (relative to projectDir) into
 * `a.task`, then require it.
 * @returns {Promise<Object|null>} a failPayload when the task is missing or the file unreadable
 */
async function requireTask(a, server) {
  try {
    await ensureTaskFromFile(a, a.projectDir || (await resolveProjectDir(server, a.projectDir).catch(() => null)));
  } catch (err) {
    return failPayload(`taskFile read failed: ${err.message}`);
  }
  if (!a.task) {
    return failPayload("Missing required field: task (or pass taskFile with a .md path)");
  }
  return null;
}

function applySessionOverrides(a, roleKeys) {
  const sessionOvr = getSessionOverrides();
  for (const key of roleKeys) {
    if (sessionOvr[key] !== undefined) { a[key] = sessionOvr[key]; }
  }
}

export async function handleCodeDirect(a, server, extra) {
  const config = await buildConfig(a, "code");
  await assertNotOnBaseBranch(config);
  const logger = createLogger(config.output.log_level, "mcp");

  const coderRole = resolveRole(config, "coder");
  await assertAgentsAvailable([coderRole.provider]);

  const projectDir = await resolveProjectDir(server, a.projectDir);
  await ensureTaskFromFile(a, projectDir);
  const runLog = createRunLog(projectDir);
  runLog.logText(`[kj_code] started — provider=${coderRole.provider}`);
  const emitter = buildDirectEmitter(server, runLog, extra);
  const eventBase = { sessionId: null, iteration: 0, startedAt: Date.now() };
  const onOutput = ({ stream, line }) => {
    emitter.emit("progress", { type: "agent:output", stage: "coder", message: line, detail: { stream, agent: coderRole.provider } });
  };
  const stallDetector = createStallDetector({
    onOutput, emitter, eventBase, stage: "coder", provider: coderRole.provider
  });

  const coder = createAgent(coderRole.provider, config, logger);
  let coderRules = null;
  if (config.coder_rules) {
    try {
      coderRules = await fs.readFile(config.coder_rules, "utf8");
    } catch { /* configured coder_rules path not found */
      try { coderRules = await fs.readFile("coder-rules.md", "utf8"); } catch { /* no coder rules file */ }
    }
  }
  const prompt = await buildCoderPrompt({ task: a.task, coderRules, methodology: config.development?.methodology || "tdd" });
  sendTrackerLog(server, "coder", "running", coderRole.provider);
  runLog.logText(`[coder] agent launched, waiting for response...`);
  let result;
  try {
    result = await coder.runTask({ prompt, role: "coder", onOutput: stallDetector.onOutput });
  } finally {
    stallDetector.stop();
    const stats = stallDetector.stats();
    runLog.logText(`[coder] finished — lines=${stats.lineCount}, bytes=${stats.bytesReceived}, elapsed=${Math.round(stats.elapsedMs / 1000)}s`);
    runLog.close();
  }

  if (!result.ok) {
    sendTrackerLog(server, "coder", "failed");
    throw new Error(result.error || result.output || `Coder failed (exit ${result.exitCode})`);
  }

  sendTrackerLog(server, "coder", "done");
  return { ok: true, output: result.output, exitCode: result.exitCode };
}

export async function handleDiscoverDirect(a, server, extra) {
  // Build context from pgTask if provided
  let context = a.context || null;
  if (a.pgTask && a.pgProject) {
    try {
      const pgContext = `Planning Game card: ${a.pgTask} (project: ${a.pgProject})`;
      context = context ? `${context}\n\n${pgContext}` : pgContext;
    } catch { /* PG not available — proceed without */ }
  }

  return runDirectRole({
    roleName: "discover",
    importRole: async () => {
      const { DiscoverRole } = await import("../../roles/discover-role.js");
      return { RoleClass: DiscoverRole };
    },
    initContext: { task: a.task },
    runInput: { task: a.task, mode: a.mode || "gaps", context },
    logStartMsg: `[kj_discover] started — mode=${a.mode || "gaps"}`,
    args: a, server, extra,
    resolveProjectDir, buildConfig, buildDirectEmitter
  });
}

export async function handleAuditDirect(a, server, extra) {
  const task = a.task || "Analyze the full codebase";
  return runDirectRole({
    roleName: "audit",
    importRole: async () => {
      const { AuditRole } = await import("../../roles/audit-role.js");
      return { RoleClass: AuditRole };
    },
    initContext: { task },
    runInput: { task, dimensions: a.dimensions || null },
    logStartMsg: `[kj_audit] started — dimensions=${a.dimensions || "all"}`,
    args: a, server, extra,
    resolveProjectDir, buildConfig, buildDirectEmitter
  });
}

export async function handleCode(a, server, extra) {
  const missingTask = await requireTask(a, server);
  if (missingTask) return missingTask;
  await runBootstrapGate(server, a);
  if (!isPreflightAcked()) {
    // Auto-acknowledge with defaults for autonomous operation
    ackPreflight({});
    const logger = createLogger("info", "mcp");
    logger.info("Preflight auto-acknowledged with default agent config");
  }
  applySessionOverrides(a, ["coder"]);
  return handleCodeDirect(a, server, extra);
}

export async function handleDiscover(a, server, extra) {
  const missingTask = await requireTask(a, server);
  if (missingTask) return missingTask;
  const validModes = new Set(["gaps", "momtest", "wendel", "classify", "jtbd"]);
  if (a.mode && !validModes.has(a.mode)) {
    return failPayload(`Invalid mode "${a.mode}". Valid values: ${[...validModes].join(", ")}`);
  }
  await runBootstrapGate(server, a);
  return handleDiscoverDirect(a, server, extra);
}

export async function handleAudit(a, server, extra) {
  await runBootstrapGate(server, a);
  const result = await handleAuditDirect(a, server, extra);

  // Return compact summary for MCP (full details in session log)
  if (result?.ok && result?.summary) {
    const compact = {
      ok: true,
      overallHealth: result.summary?.overallHealth || result.summary,
      totalFindings: result.summary?.totalFindings,
      critical: result.summary?.critical,
      high: result.summary?.high,
      topRecommendations: (result.topRecommendations || []).slice(0, 5).map(r => ({
        priority: r.priority,
        dimension: r.dimension,
        action: r.action,
        impact: r.impact
      })),
      textSummary: result.textSummary || result.summary,
      basalCost: result.basalCost ? {
        totalLines: result.basalCost.totalLines,
        totalFiles: result.basalCost.totalFiles,
        dependencies: result.basalCost.dependencies
      } : undefined
    };
    return { content: [{ type: "text", text: JSON.stringify(compact, null, 2) }] };
  }
  return result;
}
