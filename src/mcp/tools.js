export const tools = [
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
        task: { type: "string", description: "Task description for the coder (can include a Planning Game card ID like KJC-TSK-0042)" },
        pgTask: { type: "string", description: "Planning Game card ID (e.g., KJC-TSK-0042). If provided, fetches full card details as task context and updates card status on completion." },
        pgProject: { type: "string", description: "Planning Game project ID (e.g., 'Karajan Code'). Required when pgTask is used." },
        planner: { type: "string" },
        coder: { type: "string" },
        reviewer: { type: "string" },
        refactorer: { type: "string" },
        plannerModel: { type: "string" },
        coderModel: { type: "string" },
        reviewerModel: { type: "string" },
        refactorerModel: { type: "string" },
        enablePlanner: { type: "boolean" },
        enableReviewer: { type: "boolean" },
        enableRefactorer: { type: "boolean" },
        enableResearcher: { type: "boolean" },
        enableTester: { type: "boolean" },
        enableSecurity: { type: "boolean" },
        enableTriage: { type: "boolean" },
        enableSerena: { type: "boolean" },
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
    description: "Read latest or list session reports. Use trace=true for chronological stage-by-stage breakdown with timing and token usage.",
    inputSchema: {
      type: "object",
      properties: {
        list: { type: "boolean" },
        sessionId: { type: "string" },
        format: { type: "string", enum: ["text", "json"] },
        trace: { type: "boolean", description: "Show chronological trace of all pipeline stages" },
        currency: { type: "string", enum: ["usd", "eur"], description: "Display costs in this currency" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_roles",
    description: "List pipeline roles or show the template instructions for a specific role. Use action='list' to see all roles with their provider and status. Use action='show' with roleName to read the .md template.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "show"], description: "Action: list all roles or show a specific role template" },
        roleName: { type: "string", description: "Role name to show (e.g. coder, reviewer, triage, reviewer-paranoid)" },
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
