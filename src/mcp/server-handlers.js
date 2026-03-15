/**
 * MCP server handler logic.
 * Extracted from server.js for testability.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { runKjCommand } from "./run-kj.js";
import { normalizePlanArgs } from "./tool-arg-normalizers.js";
import { buildProgressHandler, buildProgressNotifier, buildPipelineTracker, sendTrackerLog } from "./progress.js";
import { createStallDetector } from "../utils/stall-detector.js";
import { runFlow, resumeFlow } from "../orchestrator.js";
import { loadConfig, applyRunOverrides, validateConfig, resolveRole } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { createAgent } from "../agents/index.js";
import { buildPlannerPrompt } from "../prompts/planner.js";
import { buildCoderPrompt } from "../prompts/coder.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { parseMaybeJsonString } from "../review/parser.js";
import { computeBaseRef, generateDiff } from "../review/diff-generator.js";
import { resolveReviewProfile } from "../review/profiles.js";
import { createRunLog, readRunLog } from "../utils/run-log.js";
import { currentBranch } from "../utils/git.js";
import { isPreflightAcked, ackPreflight, getSessionOverrides } from "./preflight.js";

/**
 * Resolve the user's project directory via MCP roots.
 * Falls back to process.cwd() if roots are not available.
 */
async function resolveProjectDir(server) {
  try {
    const { roots } = await server.listRoots();
    if (roots?.length > 0) {
      const uri = roots[0].uri;
      // MCP roots use file:// URIs
      if (uri.startsWith("file://")) return new URL(uri).pathname;
      return uri;
    }
  } catch { /* client may not support roots */ }
  return process.cwd();
}

export function asObject(value) {
  if (value && typeof value === "object") return value;
  return {};
}

export function responseText(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
  };
}

export function failPayload(message, details = {}) {
  return {
    ok: false,
    error: message,
    ...details
  };
}

const ERROR_CLASSIFIERS = [
  {
    test: (lower) => lower.includes("without output") || lower.includes("silent for") || lower.includes("unresponsive") || lower.includes("exceeded max silence"),
    category: "agent_stall",
    suggestion: "Agent output stalled. Check live details with kj_status, then retry with a smaller prompt or increase session.max_agent_silence_minutes if needed."
  },
  {
    test: (lower) => lower.includes("sonar") && (lower.includes("connect") || lower.includes("econnrefused") || lower.includes("not available") || lower.includes("not running")),
    category: "sonar_unavailable",
    suggestion: "SonarQube is not reachable. Try: kj_init to set up SonarQube, or run 'docker start sonarqube' if already installed. Use --no-sonar to skip SonarQube."
  },
  {
    test: (lower) => lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid token"),
    category: "auth_error",
    suggestion: "Authentication failed. Regenerate the SonarQube token and update it via kj_init or in ~/.karajan/kj.config.yml under sonarqube.token."
  },
  {
    test: (lower) => lower.includes("config") && (lower.includes("missing") || lower.includes("not found") || lower.includes("invalid")),
    category: "config_error",
    suggestion: "Configuration issue detected. Run kj_doctor to diagnose, or kj_init to create a fresh config."
  },
  {
    test: (lower) => lower.includes("missing provider") || lower.includes("not found") && (lower.includes("claude") || lower.includes("codex") || lower.includes("gemini") || lower.includes("aider")),
    category: "agent_missing",
    suggestion: "Required agent CLI not found. Run kj_doctor to check which agents are installed and get installation instructions."
  },
  {
    test: (lower) => lower.includes("timed out") || lower.includes("timeout"),
    category: "timeout",
    suggestion: "The agent did not complete in time. Try: (1) increase --max-iteration-minutes (default: 5), (2) split the task into smaller pieces, (3) use kj_code for single-agent tasks. If a SonarQube scan timed out, check Docker health."
  },
  {
    test: (lower) => lower.includes("you are on the base branch"),
    category: "branch_error",
    suggestion: "Create a feature branch before running Karajan. Use 'git checkout -b feat/<task-description>' and then retry. Do NOT run kj_code directly on the base branch."
  },
  {
    test: (lower) => lower.includes("not a git repository"),
    category: "git_error",
    suggestion: "Current directory is not a git repository. Navigate to your project root or initialize git with 'git init'."
  }
];

export function classifyError(error) {
  const msg = error?.message || String(error);
  const lower = msg.toLowerCase();

  const match = ERROR_CLASSIFIERS.find(c => c.test(lower));
  if (match) {
    return { category: match.category, suggestion: match.suggestion };
  }
  return { category: "unknown", suggestion: null };
}

export async function assertNotOnBaseBranch(config) {
  const baseBranch = config?.base_branch || "main";
  let branch;
  try {
    branch = await currentBranch();
  } catch {
    return; // not a git repo or detached HEAD — let downstream handle it
  }
  if (branch === baseBranch) {
    throw new Error(
      `You are on the base branch '${baseBranch}'. Karajan needs a feature branch to compute the diff for review. ` +
      `Create a new branch first (e.g. 'git checkout -b feat/<task-description>') and then run this command again. ` +
      `Do NOT run kj_code directly — create the branch first so the full pipeline (code + review) works correctly.`
    );
  }
}

export function enrichedFailPayload(error, toolName) {
  const msg = error?.message || String(error);
  const { category, suggestion } = classifyError(error);
  const payload = {
    ok: false,
    error: msg,
    tool: toolName,
    category
  };
  if (suggestion) payload.suggestion = suggestion;
  return payload;
}

export async function buildConfig(options, commandName = "run") {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, options || {});
  validateConfig(merged, commandName);
  return merged;
}

export function buildAskQuestion(server) {
  return async (question) => {
    try {
      const result = await server.elicitInput({
        message: question,
        requestedSchema: {
          type: "object",
          properties: {
            answer: { type: "string", description: "Your response" }
          },
          required: ["answer"]
        }
      });
      return result.action === "accept" ? result.content?.answer || null : null;
    } catch {
      return null;
    }
  };
}

const MAX_AUTO_RESUMES = 2;
const NON_RECOVERABLE_CATEGORIES = new Set([
  "config_error", "auth_error", "agent_missing", "branch_error", "git_error"
]);

async function attemptAutoResume({ err, config, logger, emitter, askQuestion, runLog }) {
  const { category } = classifyError(err);
  if (NON_RECOVERABLE_CATEGORIES.has(category)) return null;

  // Find session ID from most recent session file
  const { loadMostRecentSession } = await import("../session-store.js");
  let session;
  try {
    session = await loadMostRecentSession();
  } catch {
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
  const { saveSession } = await import("../session-store.js");
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

export async function handleRunDirect(a, server, extra) {
  const config = await buildConfig(a);
  await assertNotOnBaseBranch(config);
  const logger = createLogger(config.output.log_level, "mcp");

  // Best-effort session cleanup before starting
  try {
    const { cleanupExpiredSessions } = await import("../session-cleanup.js");
    await cleanupExpiredSessions({ logger });
  } catch { /* non-blocking */ }

  const requiredProviders = [
    resolveRole(config, "coder").provider,
    config.reviewer_options?.fallback_reviewer
  ];
  if (config.pipeline?.reviewer?.enabled !== false) {
    requiredProviders.push(resolveRole(config, "reviewer").provider);
  }
  if (config.pipeline?.triage?.enabled) requiredProviders.push(resolveRole(config, "triage").provider);
  if (config.pipeline?.planner?.enabled) requiredProviders.push(resolveRole(config, "planner").provider);
  if (config.pipeline?.refactorer?.enabled) requiredProviders.push(resolveRole(config, "refactorer").provider);
  if (config.pipeline?.researcher?.enabled) requiredProviders.push(resolveRole(config, "researcher").provider);
  if (config.pipeline?.tester?.enabled) requiredProviders.push(resolveRole(config, "tester").provider);
  if (config.pipeline?.security?.enabled) requiredProviders.push(resolveRole(config, "security").provider);
  await assertAgentsAvailable(requiredProviders);

  const projectDir = await resolveProjectDir(server);
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

  const projectDir = await resolveProjectDir(server);
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

function buildDirectEmitter(server, runLog, extra) {
  const emitter = new EventEmitter();
  emitter.on("progress", (event) => {
    try {
      let level = "debug";
      if (event.type === "agent:stall") level = "warning";
      else if (event.type === "agent:heartbeat") level = "info";
      server.sendLoggingMessage({ level, logger: "karajan", data: event });
    } catch { /* best-effort */ }
    if (runLog) runLog.logEvent(event);
  });
  const progressNotifier = buildProgressNotifier(extra);
  if (progressNotifier) emitter.on("progress", progressNotifier);
  return emitter;
}

export async function handlePlanDirect(a, server, extra) {
  const options = normalizePlanArgs(a);
  const config = await buildConfig(options, "plan");
  const logger = createLogger(config.output.log_level, "mcp");

  const plannerRole = resolveRole(config, "planner");
  await assertAgentsAvailable([plannerRole.provider]);

  const projectDir = await resolveProjectDir(server);
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

  const projectDir = await resolveProjectDir(server);
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
    } catch { /* no coder rules file */ }
  }
  const prompt = buildCoderPrompt({ task: a.task, coderRules, methodology: config.development?.methodology || "tdd" });
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

  const projectDir = await resolveProjectDir(server);
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

  const prompt = buildReviewerPrompt({ task: a.task, diff, reviewRules: rules, mode: config.review_mode });
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
  const config = await buildConfig(a, "discover");
  const logger = createLogger(config.output.log_level, "mcp");

  const discoverRole = resolveRole(config, "discover");
  await assertAgentsAvailable([discoverRole.provider]);

  const projectDir = await resolveProjectDir(server);
  const runLog = createRunLog(projectDir);
  runLog.logText(`[kj_discover] started — mode=${a.mode || "gaps"}`);
  const emitter = buildDirectEmitter(server, runLog, extra);
  const eventBase = { sessionId: null, iteration: 0, startedAt: Date.now() };
  const onOutput = ({ stream, line }) => {
    emitter.emit("progress", { type: "agent:output", stage: "discover", message: line, detail: { stream, agent: discoverRole.provider } });
  };
  const stallDetector = createStallDetector({
    onOutput, emitter, eventBase, stage: "discover", provider: discoverRole.provider
  });

  const { DiscoverRole } = await import("../roles/discover-role.js");
  const discover = new DiscoverRole({ config, logger, emitter });
  await discover.init({ task: a.task });

  // Build context from pgTask if provided
  let context = a.context || null;
  if (a.pgTask && a.pgProject) {
    try {
      const pgContext = `Planning Game card: ${a.pgTask} (project: ${a.pgProject})`;
      context = context ? `${context}\n\n${pgContext}` : pgContext;
    } catch { /* PG not available — proceed without */ }
  }

  sendTrackerLog(server, "discover", "running", discoverRole.provider);
  runLog.logText(`[discover] agent launched, waiting for response...`);
  let result;
  try {
    result = await discover.run({ task: a.task, mode: a.mode || "gaps", context, onOutput: stallDetector.onOutput });
  } finally {
    stallDetector.stop();
    const stats = stallDetector.stats();
    runLog.logText(`[discover] finished — lines=${stats.lineCount}, bytes=${stats.bytesReceived}, elapsed=${Math.round(stats.elapsedMs / 1000)}s`);
    runLog.close();
  }

  if (!result.ok) {
    sendTrackerLog(server, "discover", "failed");
    throw new Error(result.result?.error || result.summary || "Discovery failed");
  }

  sendTrackerLog(server, "discover", "done");
  return { ok: true, ...result.result, summary: result.summary };
}

export async function handleTriageDirect(a, server, extra) {
  const config = await buildConfig(a, "triage");
  const logger = createLogger(config.output.log_level, "mcp");

  const triageRole = resolveRole(config, "triage");
  await assertAgentsAvailable([triageRole.provider]);

  const projectDir = await resolveProjectDir(server);
  const runLog = createRunLog(projectDir);
  runLog.logText(`[kj_triage] started`);
  const emitter = buildDirectEmitter(server, runLog, extra);
  const eventBase = { sessionId: null, iteration: 0, startedAt: Date.now() };
  const onOutput = ({ stream, line }) => {
    emitter.emit("progress", { type: "agent:output", stage: "triage", message: line, detail: { stream, agent: triageRole.provider } });
  };
  const stallDetector = createStallDetector({
    onOutput, emitter, eventBase, stage: "triage", provider: triageRole.provider
  });

  const { TriageRole } = await import("../roles/triage-role.js");
  const triage = new TriageRole({ config, logger, emitter });
  await triage.init({ task: a.task });

  sendTrackerLog(server, "triage", "running", triageRole.provider);
  runLog.logText(`[triage] agent launched, waiting for response...`);
  let result;
  try {
    result = await triage.run({ task: a.task, onOutput: stallDetector.onOutput });
  } finally {
    stallDetector.stop();
    const stats = stallDetector.stats();
    runLog.logText(`[triage] finished — lines=${stats.lineCount}, bytes=${stats.bytesReceived}, elapsed=${Math.round(stats.elapsedMs / 1000)}s`);
    runLog.close();
  }

  if (!result.ok) {
    sendTrackerLog(server, "triage", "failed");
    throw new Error(result.result?.error || result.summary || "Triage failed");
  }

  sendTrackerLog(server, "triage", "done");
  return { ok: true, ...result.result, summary: result.summary };
}

export async function handleResearcherDirect(a, server, extra) {
  const config = await buildConfig(a, "researcher");
  const logger = createLogger(config.output.log_level, "mcp");

  const researcherRole = resolveRole(config, "researcher");
  await assertAgentsAvailable([researcherRole.provider]);

  const projectDir = await resolveProjectDir(server);
  const runLog = createRunLog(projectDir);
  runLog.logText(`[kj_researcher] started`);
  const emitter = buildDirectEmitter(server, runLog, extra);
  const eventBase = { sessionId: null, iteration: 0, startedAt: Date.now() };
  const onOutput = ({ stream, line }) => {
    emitter.emit("progress", { type: "agent:output", stage: "researcher", message: line, detail: { stream, agent: researcherRole.provider } });
  };
  const stallDetector = createStallDetector({
    onOutput, emitter, eventBase, stage: "researcher", provider: researcherRole.provider
  });

  const { ResearcherRole } = await import("../roles/researcher-role.js");
  const researcher = new ResearcherRole({ config, logger, emitter });
  await researcher.init({ task: a.task });

  sendTrackerLog(server, "researcher", "running", researcherRole.provider);
  runLog.logText(`[researcher] agent launched, waiting for response...`);
  let result;
  try {
    result = await researcher.run({ task: a.task, onOutput: stallDetector.onOutput });
  } finally {
    stallDetector.stop();
    const stats = stallDetector.stats();
    runLog.logText(`[researcher] finished — lines=${stats.lineCount}, bytes=${stats.bytesReceived}, elapsed=${Math.round(stats.elapsedMs / 1000)}s`);
    runLog.close();
  }

  if (!result.ok) {
    sendTrackerLog(server, "researcher", "failed");
    throw new Error(result.result?.error || result.summary || "Researcher failed");
  }

  sendTrackerLog(server, "researcher", "done");
  return { ok: true, ...result.result, summary: result.summary };
}

export async function handleArchitectDirect(a, server, extra) {
  const config = await buildConfig(a, "architect");
  const logger = createLogger(config.output.log_level, "mcp");

  const architectRole = resolveRole(config, "architect");
  await assertAgentsAvailable([architectRole.provider]);

  const projectDir = await resolveProjectDir(server);
  const runLog = createRunLog(projectDir);
  runLog.logText(`[kj_architect] started`);
  const emitter = buildDirectEmitter(server, runLog, extra);
  const eventBase = { sessionId: null, iteration: 0, startedAt: Date.now() };
  const onOutput = ({ stream, line }) => {
    emitter.emit("progress", { type: "agent:output", stage: "architect", message: line, detail: { stream, agent: architectRole.provider } });
  };
  const stallDetector = createStallDetector({
    onOutput, emitter, eventBase, stage: "architect", provider: architectRole.provider
  });

  const { ArchitectRole } = await import("../roles/architect-role.js");
  const architect = new ArchitectRole({ config, logger, emitter });
  await architect.init({ task: a.task });

  sendTrackerLog(server, "architect", "running", architectRole.provider);
  runLog.logText(`[architect] agent launched, waiting for response...`);
  let result;
  try {
    result = await architect.run({ task: a.task, researchContext: a.context || null, onOutput: stallDetector.onOutput });
  } finally {
    stallDetector.stop();
    const stats = stallDetector.stats();
    runLog.logText(`[architect] finished — lines=${stats.lineCount}, bytes=${stats.bytesReceived}, elapsed=${Math.round(stats.elapsedMs / 1000)}s`);
    runLog.close();
  }

  if (!result.ok) {
    sendTrackerLog(server, "architect", "failed");
    throw new Error(result.result?.error || result.summary || "Architect failed");
  }

  sendTrackerLog(server, "architect", "done");
  return { ok: true, ...result.result, summary: result.summary };
}

/* ── Preflight helpers ─────────────────────────────────────────────── */

const AGENT_ROLES = new Set(["coder", "reviewer", "tester", "security", "solomon"]);

async function buildPreflightRequiredResponse(toolName) {
  const { config } = await loadConfig();
  const { listAgents } = await import("../commands/agents.js");
  const agents = listAgents(config);
  const agentSummary = agents
    .filter(ag => ag.provider !== "-")
    .map(ag => {
      const modelSuffix = ag.model === "-" ? "" : ` (${ag.model})`;
      return `  ${ag.role}: ${ag.provider}${modelSuffix}`;
    })
    .join("\n");
  return responseText({
    ok: false,
    preflightRequired: true,
    message: `PREFLIGHT REQUIRED\n\nCurrent agent configuration:\n${agentSummary}\n\nAsk the human to confirm or adjust this configuration, then call kj_preflight with their response.\n\nDo NOT pass coder/reviewer parameters to ${toolName} — use kj_preflight to set them.`
  });
}

function applySessionOverrides(a, roleKeys) {
  const sessionOvr = getSessionOverrides();
  for (const key of roleKeys) {
    if (sessionOvr[key] !== undefined) { a[key] = sessionOvr[key]; }
  }
}

function parseHumanResponseOverrides(humanResponse, overrides) {
  for (const role of AGENT_ROLES) {
    const patterns = [
      new RegExp(String.raw`use\s+(\w+)\s+(?:as|for)\s+${role}`, "i"),
      new RegExp(String.raw`${role}\s*[:=]\s*(\w+)`, "i"),
      new RegExp(String.raw`set\s+${role}\s+(?:to|=)\s*(\w+)`, "i")
    ];
    for (const pat of patterns) {
      const m = pat.exec(humanResponse);
      if (m && !overrides[role]) {
        overrides[role] = m[1];
        break;
      }
    }
  }
}

function buildPreflightOverrides(a) {
  const overrides = {};
  for (const role of AGENT_ROLES) {
    if (a[role]) overrides[role] = a[role];
  }
  if (a.enableTester !== undefined) overrides.enableTester = a.enableTester;
  if (a.enableSecurity !== undefined) overrides.enableSecurity = a.enableSecurity;

  const resp = (a.humanResponse || "").toLowerCase();
  if (resp !== "ok") {
    parseHumanResponseOverrides(a.humanResponse || "", overrides);
  }
  return overrides;
}

function formatPreflightConfig(agents, overrides) {
  const lines = agents
    .filter(ag => ag.provider !== "-")
    .map(ag => {
      const ovr = overrides[ag.role] ? ` -> ${overrides[ag.role]} (session override)` : "";
      const modelSuffix = ag.model === "-" ? "" : ` (${ag.model})`;
      return `  ${ag.role}: ${ag.provider}${modelSuffix}${ovr}`;
    });
  const overrideLines = Object.entries(overrides)
    .filter(([k]) => !AGENT_ROLES.has(k))
    .map(([k, v]) => `  ${k}: ${v}`);
  return [...lines, ...overrideLines].join("\n");
}

function buildReportArgs(a) {
  const commandArgs = [];
  if (a.list) commandArgs.push("--list");
  if (a.sessionId) commandArgs.push("--session-id", String(a.sessionId));
  if (a.format) commandArgs.push("--format", String(a.format));
  if (a.trace) commandArgs.push("--trace");
  if (a.currency) commandArgs.push("--currency", String(a.currency));
  if (a.pgTask) commandArgs.push("--pg-task", String(a.pgTask));
  return commandArgs;
}

/* ── Individual tool handlers ─────────────────────────────────────── */

async function handleStatus(a, server) {
  const maxLines = a.lines || 50;
  const projectDir = await resolveProjectDir(server);
  return readRunLog(projectDir, maxLines);
}

async function handleAgents(a) {
  const action = a.action || "list";
  if (action === "set") {
    if (!a.role || !a.provider) {
      return failPayload("Missing required fields: role and provider");
    }
    const { setAgent } = await import("../commands/agents.js");
    const result = await setAgent(a.role, a.provider, { global: false });
    return { ok: true, ...result, message: `${result.role} now uses ${result.provider} (scope: ${result.scope})` };
  }
  const config = await buildConfig(a);
  const { listAgents } = await import("../commands/agents.js");
  const sessionOvr = getSessionOverrides();
  return { ok: true, agents: listAgents(config, sessionOvr) };
}

async function handlePreflight(a) {
  const overrides = buildPreflightOverrides(a);
  ackPreflight(overrides);

  const config = await buildConfig(a);
  const { listAgents } = await import("../commands/agents.js");
  const agents = listAgents(config);

  return {
    ok: true,
    message: `Preflight acknowledged. Agent configuration confirmed.`,
    config: formatPreflightConfig(agents, overrides),
    overrides
  };
}

function handleRoles(a) {
  const action = a.action || "list";
  const commandArgs = [action];
  if (action === "show" && a.roleName) commandArgs.push(a.roleName);
  return runKjCommand({ command: "roles", commandArgs, options: a });
}

async function handleResume(a, server, extra) {
  if (!a.sessionId) {
    return failPayload("Missing required field: sessionId");
  }
  return handleResumeDirect(a, server, extra);
}

async function handleRun(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  if (a.taskType) {
    const validTypes = new Set(["sw", "infra", "doc", "add-tests", "refactor"]);
    if (!validTypes.has(a.taskType)) {
      return failPayload(`Invalid taskType "${a.taskType}". Valid values: ${[...validTypes].join(", ")}`);
    }
  }
  if (!isPreflightAcked()) {
    return buildPreflightRequiredResponse("kj_run");
  }
  applySessionOverrides(a, ["coder", "reviewer", "tester", "security", "solomon", "enableTester", "enableSecurity", "enableImpeccable"]);
  return handleRunDirect(a, server, extra);
}

async function handleCode(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  if (!isPreflightAcked()) {
    return buildPreflightRequiredResponse("kj_code");
  }
  applySessionOverrides(a, ["coder"]);
  return handleCodeDirect(a, server, extra);
}

async function handleReview(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  return handleReviewDirect(a, server, extra);
}

async function handlePlan(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  return handlePlanDirect(a, server, extra);
}

async function handleDiscover(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  const validModes = new Set(["gaps", "momtest", "wendel", "classify", "jtbd"]);
  if (a.mode && !validModes.has(a.mode)) {
    return failPayload(`Invalid mode "${a.mode}". Valid values: ${[...validModes].join(", ")}`);
  }
  return handleDiscoverDirect(a, server, extra);
}

async function handleTriage(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  return handleTriageDirect(a, server, extra);
}

async function handleResearcher(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  return handleResearcherDirect(a, server, extra);
}

async function handleArchitect(a, server, extra) {
  if (!a.task) {
    return failPayload("Missing required field: task");
  }
  return handleArchitectDirect(a, server, extra);
}

/* ── Handler dispatch map ─────────────────────────────────────────── */

const toolHandlers = {
  kj_status:    (a, server) => handleStatus(a, server),
  kj_init:      (a) => runKjCommand({ command: "init", options: a }),
  kj_doctor:    (a) => runKjCommand({ command: "doctor", options: a }),
  kj_agents:    (a) => handleAgents(a),
  kj_preflight: (a) => handlePreflight(a),
  kj_config:    (a) => runKjCommand({ command: "config", commandArgs: a.json ? ["--json"] : [], options: a }),
  kj_scan:      (a) => runKjCommand({ command: "scan", options: a }),
  kj_roles:     (a) => handleRoles(a),
  kj_report:    (a) => runKjCommand({ command: "report", commandArgs: buildReportArgs(a), options: a }),
  kj_resume:    (a, server, extra) => handleResume(a, server, extra),
  kj_run:       (a, server, extra) => handleRun(a, server, extra),
  kj_code:      (a, server, extra) => handleCode(a, server, extra),
  kj_review:    (a, server, extra) => handleReview(a, server, extra),
  kj_plan:      (a, server, extra) => handlePlan(a, server, extra),
  kj_discover:    (a, server, extra) => handleDiscover(a, server, extra),
  kj_triage:      (a, server, extra) => handleTriage(a, server, extra),
  kj_researcher:  (a, server, extra) => handleResearcher(a, server, extra),
  kj_architect:   (a, server, extra) => handleArchitect(a, server, extra)
};

export async function handleToolCall(name, args, server, extra) {
  const a = asObject(args);
  const handler = toolHandlers[name];
  if (handler) {
    return handler(a, server, extra);
  }
  return failPayload(`Unknown tool: ${name}`);
}
