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
        enableBecaria: { type: "boolean", description: "Enable BecarIA Gateway (early PR + dispatch comments/reviews)" },
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
        smartModels: { type: "boolean", description: "Enable/disable smart model selection based on triage complexity" },
        checkpointInterval: { type: "number", description: "Minutes between interactive checkpoints (default: 5). Set 0 to disable." },
        taskType: { type: "string", enum: ["sw", "infra", "doc", "add-tests", "refactor"], description: "Explicit task type for policy resolution. Overrides triage classification." },
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
      "Resume a paused, stopped, or failed session by ID. For paused sessions, provide an answer. For stopped/failed sessions, re-runs the flow from scratch. Sends real-time progress notifications via MCP logging.",
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
        pgTask: { type: "string", description: "Filter reports by Planning Game card ID (e.g., KJC-TSK-0042)" },
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
    name: "kj_agents",
    description: "List or change which AI agent (provider) is assigned to each pipeline role. Use action='list' to see current assignments. Use action='set' with role and provider to change it persistently (writes to kj.config.yml, no restart needed).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "set"], description: "Action: list current agents or set a role's provider" },
        role: { type: "string", description: "Role to change (e.g. coder, reviewer, planner, triage)" },
        provider: { type: "string", description: "New provider to assign (e.g. claude, codex, gemini, aider)" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_preflight",
    description: "Confirm or adjust agent configuration before first kj_run/kj_code. REQUIRED before running any task via MCP. Show the config to the human, get their confirmation or adjustments, then call this tool with their response.",
    inputSchema: {
      type: "object",
      required: ["humanResponse"],
      properties: {
        humanResponse: { type: "string", description: "The human's response: 'ok' to confirm defaults, or specific changes like 'use gemini as coder'" },
        coder: { type: "string", description: "Override coder for this session" },
        reviewer: { type: "string", description: "Override reviewer for this session" },
        tester: { type: "string", description: "Override tester for this session" },
        security: { type: "string", description: "Override security for this session" },
        solomon: { type: "string", description: "Override solomon for this session" },
        enableTester: { type: "boolean", description: "Enable/disable tester for this session" },
        enableSecurity: { type: "boolean", description: "Enable/disable security for this session" }
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
        kjHome: { type: "string" }
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
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_status",
    description: "Show real-time status and log of the current or last Karajan run. Returns a parsed status (current stage, agent, iteration, errors) plus recent log lines. Use this to monitor progress while kj_run/kj_plan/kj_code is executing.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", description: "Number of log lines to show (default 50)" }
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
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_discover",
    description: "Analyze a task for gaps, ambiguities, and missing information before execution. Returns a verdict (ready/needs_validation) with structured gap list. Can read task details from Planning Game if pgTask is provided.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", description: "Task description to analyze for gaps" },
        mode: { type: "string", enum: ["gaps", "momtest", "wendel"], description: "Discovery mode: gaps (default), momtest (Mom Test questions), or wendel (behavior change checklist)" },
        context: { type: "string", description: "Additional context for the analysis (e.g., research output)" },
        pgTask: { type: "string", description: "Planning Game card ID (e.g., KJC-TSK-0042). If provided, fetches full card details as additional context." },
        pgProject: { type: "string", description: "Planning Game project ID. Required when pgTask is used." },
        kjHome: { type: "string" }
      }
    }
  }
];
