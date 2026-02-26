/**
 * MCP server handler logic.
 * Extracted from server.js for testability.
 */

import { EventEmitter } from "node:events";
import { runKjCommand } from "./run-kj.js";
import { normalizePlanArgs } from "./tool-arg-normalizers.js";
import { buildProgressHandler, buildProgressNotifier } from "./progress.js";
import { runFlow, resumeFlow } from "../orchestrator.js";
import { loadConfig, applyRunOverrides, validateConfig, resolveRole } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { assertAgentsAvailable } from "../agents/availability.js";

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

export function classifyError(error) {
  const msg = error?.message || String(error);
  const lower = msg.toLowerCase();

  if (lower.includes("sonar") && (lower.includes("connect") || lower.includes("econnrefused") || lower.includes("not available") || lower.includes("not running"))) {
    return {
      category: "sonar_unavailable",
      suggestion: "SonarQube is not reachable. Try: kj_init to set up SonarQube, or run 'docker start sonarqube' if already installed. Use --no-sonar to skip SonarQube."
    };
  }

  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid token")) {
    return {
      category: "auth_error",
      suggestion: "Authentication failed. Regenerate the SonarQube token and update it via kj_init or in ~/.karajan/kj.config.yml under sonarqube.token."
    };
  }

  if (lower.includes("config") && (lower.includes("missing") || lower.includes("not found") || lower.includes("invalid"))) {
    return {
      category: "config_error",
      suggestion: "Configuration issue detected. Run kj_doctor to diagnose, or kj_init to create a fresh config."
    };
  }

  if (lower.includes("missing provider") || lower.includes("not found") && (lower.includes("claude") || lower.includes("codex") || lower.includes("gemini") || lower.includes("aider"))) {
    return {
      category: "agent_missing",
      suggestion: "Required agent CLI not found. Run kj_doctor to check which agents are installed and get installation instructions."
    };
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return {
      category: "timeout",
      suggestion: "The operation timed out. Try increasing timeoutMs or maxIterationMinutes. If a scan timed out, check SonarQube health."
    };
  }

  if (lower.includes("not a git repository")) {
    return {
      category: "git_error",
      suggestion: "Current directory is not a git repository. Navigate to your project root or initialize git with 'git init'."
    };
  }

  return { category: "unknown", suggestion: null };
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

export async function buildConfig(options) {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, options || {});
  validateConfig(merged, "run");
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

export async function handleRunDirect(a, server, extra) {
  const config = await buildConfig(a);
  const logger = createLogger(config.output.log_level, "mcp");

  const requiredProviders = [
    resolveRole(config, "coder").provider,
    resolveRole(config, "reviewer").provider,
    config.reviewer_options?.fallback_reviewer
  ];
  if (config.pipeline?.planner?.enabled) requiredProviders.push(resolveRole(config, "planner").provider);
  if (config.pipeline?.refactorer?.enabled) requiredProviders.push(resolveRole(config, "refactorer").provider);
  await assertAgentsAvailable(requiredProviders);

  const emitter = new EventEmitter();
  emitter.on("progress", buildProgressHandler(server));
  const progressNotifier = buildProgressNotifier(extra);
  if (progressNotifier) emitter.on("progress", progressNotifier);

  const askQuestion = buildAskQuestion(server);
  const result = await runFlow({ task: a.task, config, logger, flags: a, emitter, askQuestion });
  return { ok: !result.paused && (result.approved !== false), ...result };
}

export async function handleResumeDirect(a, server, extra) {
  const config = await buildConfig(a);
  const logger = createLogger(config.output.log_level, "mcp");

  const emitter = new EventEmitter();
  emitter.on("progress", buildProgressHandler(server));
  const progressNotifier = buildProgressNotifier(extra);
  if (progressNotifier) emitter.on("progress", progressNotifier);

  const askQuestion = buildAskQuestion(server);
  const result = await resumeFlow({
    sessionId: a.sessionId,
    answer: a.answer || null,
    config,
    logger,
    flags: a,
    emitter,
    askQuestion
  });
  return { ok: true, ...result };
}

export async function handleToolCall(name, args, server, extra) {
  const a = asObject(args);

  if (name === "kj_init") {
    return runKjCommand({ command: "init", options: a });
  }

  if (name === "kj_doctor") {
    return runKjCommand({ command: "doctor", options: a });
  }

  if (name === "kj_config") {
    return runKjCommand({
      command: "config",
      commandArgs: a.json ? ["--json"] : [],
      options: a
    });
  }

  if (name === "kj_scan") {
    return runKjCommand({ command: "scan", options: a });
  }

  if (name === "kj_report") {
    return runKjCommand({
      command: "report",
      commandArgs: a.list ? ["--list"] : [],
      options: a
    });
  }

  if (name === "kj_resume") {
    if (!a.sessionId) {
      return failPayload("Missing required field: sessionId");
    }
    return handleResumeDirect(a, server, extra);
  }

  if (name === "kj_run") {
    if (!a.task) {
      return failPayload("Missing required field: task");
    }
    return handleRunDirect(a, server, extra);
  }

  if (name === "kj_code") {
    if (!a.task) {
      return failPayload("Missing required field: task");
    }
    return runKjCommand({ command: "code", commandArgs: [a.task], options: a });
  }

  if (name === "kj_review") {
    if (!a.task) {
      return failPayload("Missing required field: task");
    }
    return runKjCommand({ command: "review", commandArgs: [a.task], options: a });
  }

  if (name === "kj_plan") {
    if (!a.task) {
      return failPayload("Missing required field: task");
    }
    const options = normalizePlanArgs(a);
    return runKjCommand({ command: "plan", commandArgs: [a.task], options });
  }

  return failPayload(`Unknown tool: ${name}`);
}
