/**
 * Direct role handler logic (code, review, plan, audit, discover, triage, researcher, architect, impeccable).
 * Extracted from server-handlers.js for maintainability.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { resolveRole } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import { assertAgentsAvailable } from "../../agents/availability.js";
import { createAgent } from "../../agents/index.js";
import { buildPlannerPrompt } from "../../prompts/planner.js";
import { buildCoderPrompt } from "../../prompts/coder.js";
import { buildReviewerPrompt } from "../../prompts/reviewer.js";
import { parseMaybeJsonString } from "../../review/parser.js";
import { computeBaseRef, generateDiff } from "../../review/diff-generator.js";
import { resolveReviewProfile } from "../../review/profiles.js";
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
} from "../server-handlers.js";

/**
 * Run bootstrap gate: validate all environment prerequisites before execution.
 */
async function runBootstrapGate(server, a) {
  const projectDir = await resolveProjectDir(server, a.projectDir);
  const { config } = await loadConfig(projectDir);
  await ensureBootstrap(projectDir, config);
}

function applySessionOverrides(a, roleKeys) {
  const sessionOvr = getSessionOverrides();
  for (const key of roleKeys) {
    if (sessionOvr[key] !== undefined) { a[key] = sessionOvr[key]; }
  }
}

export async function handlePlanDirect(a, server, extra) {
  const { normalizePlanArgs } = await import("../tool-arg-normalizers.js");
  const options = normalizePlanArgs(a);
  const config = await buildConfig(options, "plan");
  const logger = createLogger(config.output.log_level, "mcp");

  const plannerRole = resolveRole(config, "planner");
  await assertAgentsAvailable([plannerRole.provider]);

  const projectDir = await resolveProjectDir(server, a.projectDir);
  const runLog = createRunLog(projectDir);
  const silenceTimeoutMs = Number(config?.session?.max_agent_silence_minutes) > 0
    ? Math.round(Number(config.session.max_agent_silence_minutes) * 60 * 1000)
    : undefined;
  const plannerTimeoutMs = Number(config?.session?.max_planner_minutes) > 0
    ? Math.round(Number(config.session.max_planner_minutes) * 60 * 1000)
    : undefined;
  const silenceLabel = silenceTimeoutMs ? `${Math.round(silenceTimeoutMs / 1000)}s` : "disabled";
  const runtimeLabel = plannerTimeoutMs ? `${Math.round(plannerTimeoutMs / 1000)}s` : "disabled";
  runLog.logText(
    `[kj_plan] started — provider=${plannerRole.provider}, max_silence=${silenceLabel}, max_runtime=${runtimeLabel}`
  );
  const emitter = buildDirectEmitter(server, runLog, extra);
  const eventBase = { sessionId: null, iteration: 0, startedAt: Date.now() };
  const onOutput = ({ stream, line }) => {
    emitter.emit("progress", { type: "agent:output", stage: "planner", message: line, detail: { stream, agent: plannerRole.provider } });
  };
  const stallDetector = createStallDetector({
    onOutput, emitter, eventBase, stage: "planner", provider: plannerRole.provider
  });

  const planner = createAgent(plannerRole.provider, config, logger);
  const prompt = buildPlannerPrompt({ task: a.task, context: a.context });
  sendTrackerLog(server, "planner", "running", plannerRole.provider);
  runLog.logText(`[planner] agent launched, waiting for response...`);
  let result;
  let plannerStats = null;
  try {
    result = await planner.runTask({
      prompt,
      role: "planner",
      onOutput: stallDetector.onOutput,
      silenceTimeoutMs,
      timeoutMs: plannerTimeoutMs
    });
  } finally {
    stallDetector.stop();
    plannerStats = stallDetector.stats();
    runLog.logText(
      `[planner] finished — lines=${plannerStats.lineCount}, bytes=${plannerStats.bytesReceived}, elapsed=${Math.round(plannerStats.elapsedMs / 1000)}s`
    );
    runLog.close();
  }

  if (!result.ok) {
    sendTrackerLog(server, "planner", "failed");
    const baseError = result.error || result.output || "Planner failed";
    const statsSuffix = plannerStats
      ? ` [lines=${plannerStats.lineCount}, bytes=${plannerStats.bytesReceived}, elapsed=${Math.round(plannerStats.elapsedMs / 1000)}s]`
      : "";
    throw new Error(`${baseError}${statsSuffix}`);
  }

  sendTrackerLog(server, "planner", "done");
  const parsed = parseMaybeJsonString(result.output);
  return { ok: true, plan: parsed || result.output, raw: result.output };
}

export async function handleCodeDirect(a, server, extra) {
  const config = await buildConfig(a, "code");
  await assertNotOnBaseBranch(config);
  const logger = createLogger(config.output.log_level, "mcp");

  const coderRole = resolveRole(config, "coder");
  await assertAgentsAvailable([coderRole.provider]);

  const projectDir = await resolveProjectDir(server, a.projectDir);
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

export async function handleReviewDirect(a, server, extra) {
  const config = await buildConfig(a, "review");
  await assertNotOnBaseBranch(config);
  const logger = createLogger(config.output.log_level, "mcp");

  const reviewerRole = resolveRole(config, "reviewer");
  await assertAgentsAvailable([reviewerRole.provider, config.reviewer_options?.fallback_reviewer]);

  const projectDir = await resolveProjectDir(server, a.projectDir);
  const runLog = createRunLog(projectDir);
  runLog.logText(`[kj_review] started — provider=${reviewerRole.provider}`);
  const emitter = buildDirectEmitter(server, runLog, extra);
  const eventBase = { sessionId: null, iteration: 0, startedAt: Date.now() };
  const onOutput = ({ stream, line }) => {
    emitter.emit("progress", { type: "agent:output", stage: "reviewer", message: line, detail: { stream, agent: reviewerRole.provider } });
  };
  const stallDetector = createStallDetector({
    onOutput, emitter, eventBase, stage: "reviewer", provider: reviewerRole.provider
  });

  const reviewer = createAgent(reviewerRole.provider, config, logger);
  const resolvedBase = await computeBaseRef({ baseBranch: config.base_branch, baseRef: a.baseRef });
  const diff = await generateDiff({ baseRef: resolvedBase });
  const { rules } = await resolveReviewProfile({ mode: config.review_mode, projectDir: process.cwd() });

  const prompt = await buildReviewerPrompt({ task: a.task, diff, reviewRules: rules, mode: config.review_mode });
  sendTrackerLog(server, "reviewer", "running", reviewerRole.provider);
  runLog.logText(`[reviewer] agent launched, waiting for response...`);
  let result;
  try {
    result = await reviewer.reviewTask({ prompt, role: "reviewer", onOutput: stallDetector.onOutput });
  } finally {
    stallDetector.stop();
    const stats = stallDetector.stats();
    runLog.logText(`[reviewer] finished — lines=${stats.lineCount}, bytes=${stats.bytesReceived}, elapsed=${Math.round(stats.elapsedMs / 1000)}s`);
    runLog.close();
  }

  if (!result.ok) {
    sendTrackerLog(server, "reviewer", "failed");
    throw new Error(result.error || result.output || `Reviewer failed (exit ${result.exitCode})`);
  }

  sendTrackerLog(server, "reviewer", "done");
  const parsed = parseMaybeJsonString(result.output);
  return { ok: true, review: parsed || result.output, raw: result.output };
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

export async function handleTriageDirect(a, server, extra) {
  return runDirectRole({
    roleName: "triage",
    importRole: async () => {
      const { TriageRole } = await import("../../roles/triage-role.js");
      return { RoleClass: TriageRole };
    },
    initContext: { task: a.task },
    runInput: { task: a.task },
    args: a, server, extra,
    resolveProjectDir, buildConfig, buildDirectEmitter
  });
}

export async function handleResearcherDirect(a, server, extra) {
  return runDirectRole({
    roleName: "researcher",
    importRole: async () => {
      const { ResearcherRole } = await import("../../roles/researcher-role.js");
      return { RoleClass: ResearcherRole };
    },
    initContext: { task: a.task },
    runInput: { task: a.task },
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

export async function handleArchitectDirect(a, server, extra) {
  return runDirectRole({
    roleName: "architect",
    importRole: async () => {
      const { ArchitectRole } = await import("../../roles/architect-role.js");
      return { RoleClass: ArchitectRole };
    },
    initContext: { task: a.task },
    runInput: { task: a.task, researchContext: a.context || null },
    args: a, server, extra,
    resolveProjectDir, buildConfig, buildDirectEmitter
  });
}

export async function handleCode(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
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

export async function handleReview(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  await runBootstrapGate(server, a);
  return handleReviewDirect(a, server, extra);
}

export async function handlePlan(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  await runBootstrapGate(server, a);
  return handlePlanDirect(a, server, extra);
}

export async function handleDiscover(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  const validModes = new Set(["gaps", "momtest", "wendel", "classify", "jtbd"]);
  if (a.mode && !validModes.has(a.mode)) {
    return failPayload(`Invalid mode "${a.mode}". Valid values: ${[...validModes].join(", ")}`);
  }
  await runBootstrapGate(server, a);
  return handleDiscoverDirect(a, server, extra);
}

export async function handleTriage(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  await runBootstrapGate(server, a);
  return handleTriageDirect(a, server, extra);
}

export async function handleResearcher(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  await runBootstrapGate(server, a);
  return handleResearcherDirect(a, server, extra);
}

export async function handleArchitect(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  await runBootstrapGate(server, a);
  return handleArchitectDirect(a, server, extra);
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
