#!/usr/bin/env node
import { EventEmitter } from "node:events";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runKjCommand } from "./run-kj.js";
import { normalizePlanArgs } from "./tool-arg-normalizers.js";
import { runFlow, resumeFlow } from "../orchestrator.js";
import { loadConfig, applyRunOverrides, validateConfig, resolveRole } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { assertAgentsAvailable } from "../agents/availability.js";

function asObject(value) {
  if (value && typeof value === "object") return value;
  return {};
}

function responseText(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
  };
}

function failPayload(message, details = {}) {
  return {
    ok: false,
    error: message,
    ...details
  };
}

async function buildConfig(options) {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, options || {});
  validateConfig(merged, "run");
  return merged;
}

function buildAskQuestion(server) {
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

function buildProgressHandler(server) {
  return (event) => {
    try {
      server.sendLoggingMessage({
        level: event.type === "agent:output" ? "debug" : event.status === "fail" ? "error" : "info",
        logger: "karajan",
        data: event
      });
    } catch {
      // best-effort: if logging fails, continue
    }
  };
}

async function handleRunDirect(a, server, extra) {
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

async function handleResumeDirect(a, server, extra) {
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

// Maps orchestrator event types to progress steps for notifications/progress
const PROGRESS_STAGES = [
  "session:start", "planner:start", "planner:end", "coder:start", "coder:end", "refactorer:start", "refactorer:end", "tdd:result",
  "sonar:start", "sonar:end", "reviewer:start", "reviewer:end",
  "iteration:end", "session:end"
];

function buildProgressNotifier(extra) {
  const progressToken = extra?._meta?.progressToken;
  if (progressToken === undefined) return null;

  const total = PROGRESS_STAGES.length;
  return (event) => {
    const idx = PROGRESS_STAGES.indexOf(event.type);
    if (idx < 0) return;
    try {
      extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: idx + 1,
          total,
          message: event.message || event.type
        }
      });
    } catch {
      // best-effort
    }
  };
}

async function handleToolCall(name, args, server, extra) {
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

const tools = [
  {
    name: "kj_init",
    description: "Initialize karajan-code config, review rules, and SonarQube",
    inputSchema: {
      type: "object",
      properties: {
        kjHome: { type: "string", description: "Optional KJ_HOME directory" },
        timeoutMs: { type: "number", description: "Optional command timeout in ms" }
      }
    }
  },
  {
    name: "kj_doctor",
    description: "Check system dependencies and agent CLIs",
    inputSchema: {
      type: "object",
      properties: {
        kjHome: { type: "string" },
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "kj_config",
    description: "Show kj configuration",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "boolean" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_scan",
    description: "Run SonarQube scan for current project",
    inputSchema: {
      type: "object",
      properties: {
        kjHome: { type: "string" },
        sonarToken: { type: "string" },
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "kj_run",
    description:
      "Run full coder -> sonar -> reviewer loop. Sends real-time progress notifications via MCP logging. May return paused state with a question if fail-fast is triggered.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", description: "Task description for the coder" },
        planner: { type: "string" },
        coder: { type: "string" },
        reviewer: { type: "string" },
        refactorer: { type: "string" },
        plannerModel: { type: "string" },
        coderModel: { type: "string" },
        reviewerModel: { type: "string" },
        refactorerModel: { type: "string" },
        enablePlanner: { type: "boolean" },
        enableRefactorer: { type: "boolean" },
        reviewerFallback: { type: "string" },
        reviewerRetries: { type: "number" },
        mode: { type: "string" },
        maxIterations: { type: "number" },
        maxIterationMinutes: { type: "number" },
        maxTotalMinutes: { type: "number" },
        baseBranch: { type: "string" },
        baseRef: { type: "string" },
        methodology: { type: "string", enum: ["tdd", "standard"] },
        autoCommit: { type: "boolean" },
        autoPush: { type: "boolean" },
        autoPr: { type: "boolean" },
        autoRebase: { type: "boolean" },
        branchPrefix: { type: "string" },
        noSonar: { type: "boolean" },
        kjHome: { type: "string" },
        sonarToken: { type: "string" },
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "kj_resume",
    description:
      "Resume a paused session by ID. Provide an answer to the question that caused the pause. Sends real-time progress notifications via MCP logging.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "Session ID to resume" },
        answer: { type: "string", description: "Answer to the question that caused the pause" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_report",
    description: "Read latest or list session reports",
    inputSchema: {
      type: "object",
      properties: {
        list: { type: "boolean" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_code",
    description: "Run coder-only mode",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        coder: { type: "string" },
        coderModel: { type: "string" },
        kjHome: { type: "string" },
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "kj_review",
    description: "Run reviewer-only mode against current diff",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        reviewer: { type: "string" },
        reviewerModel: { type: "string" },
        baseRef: { type: "string" },
        kjHome: { type: "string" },
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "kj_plan",
    description: "Generate implementation plan for a task",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        planner: { type: "string" },
        plannerModel: { type: "string" },
        coder: { type: "string", description: "Legacy alias for planner" },
        coderModel: { type: "string", description: "Legacy alias for plannerModel" },
        kjHome: { type: "string" },
        timeoutMs: { type: "number" }
      }
    }
  }
];

const server = new Server(
  {
    name: "karajan-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {},
      logging: {},
      elicitation: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const name = request.params?.name;
  const args = request.params?.arguments || {};

  try {
    const result = await handleToolCall(name, args, server, extra);
    return responseText(result);
  } catch (error) {
    return responseText(failPayload(error?.message || String(error)));
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
