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
      "Run the full Karajan pipeline. IMPORTANT: Pass the user's task description exactly as they wrote it. Do NOT group, split, reorder, or modify tasks yourself. Karajan handles decomposition, role activation, iteration, and quality gates internally. Do NOT override pipeline parameters (enableHuReviewer, mode, methodology) unless the user explicitly requested it. If you have observations about the task, use kj_suggest instead.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", description: "Task description for the coder (can include a Planning Game card ID like KJC-TSK-0042)" },
        plan: { type: "string", description: "Plan ID from kj_plan. Loads persisted plan context and skips researcher/architect/planner stages." },
        projectDir: { type: "string", description: "Absolute path to the project directory. Required when KJ MCP server runs from a different directory than the target project." },
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
        enableImpeccable: { type: "boolean" },
        enableTriage: { type: "boolean" },
        enableDiscover: { type: "boolean" },
        enableArchitect: { type: "boolean" },
        enableHuReviewer: { type: "boolean" },
        architectModel: { type: "string" },
        huFile: { type: "string", description: "Path to YAML file with HU stories to certify before coding" },
        enableSerena: { type: "boolean" },
        enableCi: { type: "boolean", description: "Enable Karajan CI (early PR + dispatch comments/reviews)" },
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
        autoSimplify: { type: "boolean", description: "Auto-simplify pipeline for simple tasks (level trivial/simple). Disable with false to force full pipeline." },
        smartModels: { type: "boolean", description: "Enable/disable smart model selection based on triage complexity" },
        checkpointInterval: { type: "number", description: "Minutes between interactive checkpoints (default: 5). Set 0 to disable." },
        taskType: { type: "string", enum: ["sw", "infra", "doc", "add-tests", "refactor"], description: "Explicit task type for policy resolution. Overrides triage classification." },
        quiet: { type: "boolean", description: "Suppress raw agent output lines, show only stage status (default: true). Set false for verbose output." },
        noSonar: { type: "boolean" },
        design: { type: "boolean", description: "Activate design refactoring mode. Impeccable role applies design changes instead of just auditing." },
        enableSonarcloud: { type: "boolean", description: "Enable SonarCloud scan (complementary to SonarQube)" },
        kjHome: { type: "string" },
        sonarToken: { type: "string" },
        timeoutMs: { type: "number" },
        domain: { type: "string", description: "Domain knowledge: inline text describing the project domain, or absolute path to a .md file. Auto-saved to .karajan/domains/ for the curator." }
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
        projectDir: { type: "string", description: "Absolute path to the project directory" },
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
    description: "Run coder-only mode. Pass the user's task exactly as described. Do NOT split or reinterpret the task.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        coder: { type: "string" },
        coderModel: { type: "string" },
        projectDir: { type: "string", description: "Absolute path to the project directory" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_review",
    description: "Run reviewer-only mode against current diff. Do NOT filter or pre-process the diff before passing it.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        reviewer: { type: "string" },
        reviewerModel: { type: "string" },
        baseRef: { type: "string" },
        projectDir: { type: "string", description: "Absolute path to the project directory" },
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
    description: "Generate implementation plan for a task. Pass the task as the user described it. Karajan's planner decides the approach.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
        planner: { type: "string" },
        plannerModel: { type: "string" },
        coder: { type: "string", description: "Legacy alias for planner" },
        coderModel: { type: "string", description: "Legacy alias for plannerModel" },
        projectDir: { type: "string", description: "Absolute path to the project directory" },
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
        mode: { type: "string", enum: ["gaps", "momtest", "wendel", "classify", "jtbd"], description: "Discovery mode: gaps (default), momtest (Mom Test questions), wendel (behavior change checklist), classify (START/STOP/DIFFERENT), or jtbd (Jobs-to-be-Done)" },
        context: { type: "string", description: "Additional context for the analysis (e.g., research output)" },
        pgTask: { type: "string", description: "Planning Game card ID (e.g., KJC-TSK-0042). If provided, fetches full card details as additional context." },
        pgProject: { type: "string", description: "Planning Game project ID. Required when pgTask is used." },
        projectDir: { type: "string", description: "Absolute path to the project directory" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_triage",
    description: "Classify task complexity and recommend which pipeline roles to activate. Returns level (trivial/simple/medium/complex), taskType, recommended roles, and optional decomposition.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", description: "Task description to classify" },
        projectDir: { type: "string", description: "Absolute path to the project directory" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_researcher",
    description: "Research the codebase for a task. Identifies affected files, patterns, constraints, prior decisions, risks, and test coverage.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", description: "Task description to research" },
        projectDir: { type: "string", description: "Absolute path to the project directory" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_architect",
    description: "Design solution architecture for a task. Returns layers, patterns, data model, API contracts, tradeoffs, and a verdict (ready/needs_clarification).",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", description: "Task description to architect" },
        context: { type: "string", description: "Additional context (e.g., researcher output)" },
        projectDir: { type: "string", description: "Absolute path to the project directory" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_audit",
    description: "Analyze codebase health without modifying files. Returns findings across security, code quality, performance, architecture, and testing dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute path to the project to audit" },
        dimensions: { type: "string", description: "Comma-separated dimensions to analyze: security,codeQuality,performance,architecture,testing (default: all)" },
        kjHome: { type: "string" }
      }
    }
  },
  {
    name: "kj_board",
    description: "Start, stop, or check status of the HU Board dashboard",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "stop", "status"], description: "Action to perform (default: status)" },
        port: { type: "number", description: "Port (default: 4000)" }
      }
    }
  },
  {
    name: "kj_hu",
    description: "Manage user stories (HUs) in the local board",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["create", "update", "list", "get"], description: "Action to perform" },
        title: { type: "string", description: "HU title (required for create)" },
        description: { type: "string", description: "HU description" },
        acceptanceCriteria: { type: "string", description: "Acceptance criteria" },
        huId: { type: "string", description: "HU ID (required for update/get)" },
        status: { type: "string", description: "HU status (for create/update)", enum: ["pending", "coding", "reviewing", "done", "failed", "blocked"] },
        projectDir: { type: "string", description: "Project directory (defaults to cwd)" }
      }
    }
  },
  {
    name: "kj_suggest",
    description: "Propose an observation or suggestion to Karajan's Solomon engine. Solomon will evaluate it and decide whether to accept, reject, or ask the human. You CANNOT override pipeline decisions through this tool, only propose.",
    inputSchema: {
      type: "object",
      required: ["suggestion"],
      properties: {
        suggestion: { type: "string", description: "What you observed or want to propose" },
        context: { type: "string", description: "Additional context (current HU, iteration, etc.)" },
        projectDir: { type: "string", description: "Project directory" }
      }
    }
  },
  {
    name: "kj_skills",
    description: "Manage OpenSkills for domain-specific agent knowledge. Install skills from the marketplace or GitHub repos to give coders domain expertise.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["install", "remove", "list", "read"], description: "Action to perform" },
        source: { type: "string", description: "Skill source: marketplace name, GitHub URL, or local path (for install)" },
        name: { type: "string", description: "Skill name (for remove/read)" },
        global: { type: "boolean", description: "Install globally (~/.agent/skills/) instead of project-local" },
        projectDir: { type: "string", description: "Project directory" }
      },
      required: ["action"]
    }
  },
  {
    name: "kj_undo",
    description: "Revert the last pipeline run by resetting to the pre-pipeline commit. Default: soft reset (keeps changes staged). Use hard=true to discard all changes.",
    inputSchema: {
      type: "object",
      properties: {
        hard: { type: "boolean", description: "If true, discard all changes (git reset --hard). Default: false (soft reset, keeps changes staged)." },
        projectDir: { type: "string", description: "Absolute path to the project directory" }
      }
    }
  }
];
