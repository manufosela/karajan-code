/**
 * Run and Resume handler logic.
 * Extracted from server-handlers.js for maintainability.
 */

import { EventEmitter } from "node:events";
import { runFlow, resumeFlow } from "../../orchestrator.js";
import { loadConfig, applyRunOverrides, validateConfig, resolveRole } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import { assertAgentsAvailable } from "../../agents/availability.js";
import { createRunLog } from "../../utils/run-log.js";
import { buildProgressHandler, buildProgressNotifier, buildPipelineTracker } from "../progress.js";
import { isPreflightAcked, ackPreflight, getSessionOverrides } from "../preflight.js";
import { ensureBootstrap } from "../../bootstrap.js";
import { validateSovereignty } from "../sovereignty-guard.js";
import {
  resolveProjectDir,
  failPayload,
  classifyError,
  assertNotOnBaseBranch,
  buildConfig,
  buildAskQuestion,
  enrichedFailPayload,
} from "../shared-helpers.js";

const MAX_AUTO_RESUMES = 2;
const NON_RECOVERABLE_CATEGORIES = new Set([
  "config_error", "auth_error", "agent_missing", "branch_error", "git_error", "bootstrap_error"
]);

async function attemptAutoResume({ err, config, logger, emitter, askQuestion, runLog }) {
  const { category } = classifyError(err);
  if (NON_RECOVERABLE_CATEGORIES.has(category)) return null;

  // Find session ID from most recent session file
  const { loadMostRecentSession } = await import("../../session-store.js");
  let session;
  try {
    session = await loadMostRecentSession();
  } catch { /* no session store or read error */
    return null;
  }
  if (!session || !["failed", "stopped"].includes(session.status)) return null;

  const maxRetries = config.session?.max_auto_resumes ?? MAX_AUTO_RESUMES;
  const autoResumeCount = session.auto_resume_count || 0;
  if (autoResumeCount >= maxRetries) {
    runLog.logText(`[resilient] auto-resume limit reached (${maxRetries}), giving up`);
    return null;
  }

  runLog.logText(`[resilient] run failed (${category}), auto-resuming (${autoResumeCount + 1}/${maxRetries})...`);
  emitter.emit("progress", {
    type: "resilient:auto_resume",
    attempt: autoResumeCount + 1,
    maxRetries,
    errorCategory: category,
    sessionId: session.id
  });

  // Increment counter and save before resuming
  const { saveSession } = await import("../../session-store.js");
  session.auto_resume_count = autoResumeCount + 1;
  await saveSession(session);

  try {
    const result = await resumeFlow({
      sessionId: session.id,
      config,
      logger,
      flags: {},
      emitter,
      askQuestion
    });
    const ok = !result.paused && (result.approved !== false);
    runLog.logText(`[resilient] auto-resume ${ok ? "succeeded" : "finished"} — ok=${ok}`);
    return { ok, ...result, autoResumed: true, autoResumeAttempt: autoResumeCount + 1 };
  } catch (error) {
    // Recursive: try again if still within limits
    const nestedResult = await attemptAutoResume({
      err: error, config, logger, emitter, askQuestion, runLog
    });
    if (nestedResult) return nestedResult;
    runLog.logText(`[resilient] auto-resume failed: ${error.message}`);
    return null;
  }
}

const PIPELINE_PROVIDER_ROLES = [
  ["triage", true],
  ["planner", true],
  ["refactorer", true],
  ["researcher", true],
  ["tester", true],
  ["security", true]
];

function collectRequiredProviders(config) {
  const providers = [
    resolveRole(config, "coder").provider,
    config.reviewer_options?.fallback_reviewer
  ];
  if (config.pipeline?.reviewer?.enabled !== false) {
    providers.push(resolveRole(config, "reviewer").provider);
  }
  for (const [role, requireEnabled] of PIPELINE_PROVIDER_ROLES) {
    if (requireEnabled && config.pipeline?.[role]?.enabled) {
      providers.push(resolveRole(config, role).provider);
    }
  }
  return providers;
}

export async function handleRunDirect(a, server, extra) {
  const config = await buildConfig(a);
  await assertNotOnBaseBranch(config);
  const logger = createLogger(config.output.log_level, "mcp");

  // Best-effort session cleanup before starting
  try {
    const { cleanupExpiredSessions } = await import("../../session-cleanup.js");
    await cleanupExpiredSessions({ logger });
  } catch { /* non-blocking */ }

  await assertAgentsAvailable(collectRequiredProviders(config));

  const projectDir = await resolveProjectDir(server, a.projectDir);
  const runLog = createRunLog(projectDir);
  runLog.logText(`[kj_run] started — task="${a.task.slice(0, 80)}..."`);

  const emitter = new EventEmitter();
  emitter.on("progress", buildProgressHandler(server));
  emitter.on("progress", (event) => runLog.logEvent(event));
  const progressNotifier = buildProgressNotifier(extra);
  if (progressNotifier) emitter.on("progress", progressNotifier);
  buildPipelineTracker(config, emitter);

  const askQuestion = buildAskQuestion(server);
  const pgTaskId = a.pgTask || null;
  const pgProject = a.pgProject || config.planning_game?.project_id || null;
  try {
    const result = await runFlow({ task: a.task, config, logger, flags: a, emitter, askQuestion, pgTaskId, pgProject });
    runLog.logText(`[kj_run] finished — ok=${!result.paused && (result.approved !== false)}`);
    return { ok: !result.paused && (result.approved !== false), ...result };
  } catch (err) {
    const autoResumeResult = await attemptAutoResume({
      err, config, logger, emitter, askQuestion, runLog, progressNotifier, extra
    });
    if (autoResumeResult) return autoResumeResult;
    throw err;
  } finally {
    runLog.close();
  }
}

export async function handleResumeDirect(a, server, extra) {
  const config = await buildConfig(a);
  const logger = createLogger(config.output.log_level, "mcp");

  const projectDir = await resolveProjectDir(server, a.projectDir);
  const runLog = createRunLog(projectDir);
  runLog.logText(`[kj_resume] started — session="${a.sessionId}"`);

  const emitter = new EventEmitter();
  emitter.on("progress", buildProgressHandler(server));
  emitter.on("progress", (event) => runLog.logEvent(event));
  const progressNotifier = buildProgressNotifier(extra);
  if (progressNotifier) emitter.on("progress", progressNotifier);

  const askQuestion = buildAskQuestion(server);
  try {
    const result = await resumeFlow({
      sessionId: a.sessionId,
      answer: a.answer || null,
      config,
      logger,
      flags: a,
      emitter,
      askQuestion
    });
    const ok = !result.paused && (result.approved !== false);
    runLog.logText(`[kj_resume] finished — ok=${ok}`);
    return { ok, ...result };
  } catch (err) {
    runLog.logText(`[kj_resume] failed: ${err.message}`);
    throw err;
  } finally {
    runLog.close();
  }
}

const RESUME_MAX_ANSWER_LENGTH = 500;
const RESUME_INJECTION_PATTERNS = [
  /ignore\s+(previous|all|above)\s+(instructions|rules|prompts)/i,
  /you\s+are\s+now/i,
  /new\s+instructions?:/i,
  /override\s+(all|security|guardrails|rules)/i,
  /skip\s+(all\s+)?(review|test|sonar|security|solomon|guard)s?\b/i,
  /disable\s+(tdd|review|test|sonar|security)\b/i,
  /set\s+(status|approved|verdict)\s*(=|to|:)/i,
  /force\s+(approve|merge|push|commit)\b/i,
];

export function validateResumeAnswer(answer) {
  if (answer == null || answer === "") return { valid: true, sanitized: answer ?? null };
  if (typeof answer !== "string") return { valid: true, sanitized: String(answer) };
  if (answer.length > RESUME_MAX_ANSWER_LENGTH) {
    return { valid: false, reason: `Answer too long (${answer.length} chars, max ${RESUME_MAX_ANSWER_LENGTH})` };
  }
  for (const pattern of RESUME_INJECTION_PATTERNS) {
    if (pattern.test(answer)) {
      return { valid: false, reason: "Answer rejected: matches guardrail bypass pattern" };
    }
  }
  return { valid: true, sanitized: answer.trim() };
}

/**
 * Run bootstrap gate: validate all environment prerequisites before execution.
 * Throws if any prerequisite fails.
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

export async function handleResume(a, server, extra) {
  if (!a.sessionId) {
    return failPayload("Missing required field: sessionId");
  }
  await runBootstrapGate(server, a);
  if (a.answer) {
    const validation = validateResumeAnswer(a.answer);
    if (!validation.valid) {
      return failPayload(`Resume answer rejected: ${validation.reason}`);
    }
    a.answer = validation.sanitized;
  }
  applySessionOverrides(a, ["coder", "reviewer", "tester", "security", "solomon", "enableTester", "enableSecurity", "enableImpeccable"]);
  return handleResumeDirect(a, server, extra);
}

export async function handleRun(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  if (a.taskType) {
    const validTypes = new Set(["sw", "infra", "doc", "add-tests", "refactor"]);
    if (!validTypes.has(a.taskType)) {
      return failPayload(`Invalid taskType "${a.taskType}". Valid values: ${[...validTypes].join(", ")}`);
    }
  }

  // Sovereignty guard: sanitise params and check for active sessions
  const projectDir = await resolveProjectDir(server, a.projectDir);
  const sovereignty = validateSovereignty(a, { projectDir });
  if (sovereignty.error) {
    return failPayload(sovereignty.error);
  }
  if (sovereignty.warnings.length > 0) {
    const logger = createLogger("info", "mcp");
    for (const w of sovereignty.warnings) logger.warn(`[sovereignty] ${w}`);
  }
  Object.assign(a, sovereignty.params);

  await runBootstrapGate(server, a);
  if (!isPreflightAcked()) {
    // Auto-acknowledge with defaults for autonomous operation
    ackPreflight({});
    const logger = createLogger("info", "mcp");
    logger.info("Preflight auto-acknowledged with default agent config");
  }
  applySessionOverrides(a, ["coder", "reviewer", "tester", "security", "solomon", "enableTester", "enableSecurity", "enableImpeccable"]);
  return handleRunDirect(a, server, extra);
}
