#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runKjCommand } from "./run-kj.js";

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

async function handleToolCall(name, args) {
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
    return runKjCommand({ command: "resume", commandArgs: [a.sessionId], options: a });
  }

  if (name === "kj_run") {
    if (!a.task) {
      return failPayload("Missing required field: task");
    }
    return runKjCommand({ command: "run", commandArgs: [a.task], options: a });
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
    return runKjCommand({ command: "plan", commandArgs: [a.task], options: a });
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
    description: "Run full coder -> sonar -> reviewer loop",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        coder: { type: "string" },
        reviewer: { type: "string" },
        reviewerFallback: { type: "string" },
        reviewerRetries: { type: "number" },
        mode: { type: "string" },
        maxIterations: { type: "number" },
        maxIterationMinutes: { type: "number" },
        maxTotalMinutes: { type: "number" },
        baseBranch: { type: "string" },
        baseRef: { type: "string" },
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
    description: "Resume a previous session by ID",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string" },
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
        coder: { type: "string" },
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
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params?.name;
  const args = request.params?.arguments || {};

  try {
    const result = await handleToolCall(name, args);
    return responseText(result);
  } catch (error) {
    return responseText(failPayload(error?.message || String(error)));
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
