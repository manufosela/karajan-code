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
    description: "Check system dependencies, agent CLIs, ports, tokens and MCP health — auto-remediates when possible",
    inputSchema: {
      type: "object",
      properties: {
        kjHome: { type: "string" },
        timeoutMs: { type: "number" },
        checkOnly: { type: "boolean", description: "Detect only, do not apply fixes" },
        yes: { type: "boolean", description: "Auto-confirm prompts for invasive remediations" },
        json: { type: "boolean", description: "Emit machine-readable JSON output" },
        verbose: { type: "boolean", description: "Include fix hints and timing per check" }
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
    description: "Confirm or adjust agent configuration before first kj_code. REQUIRED before running any task via MCP. Show the config to the human, get their confirmation or adjustments, then call this tool with their response.",
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
      properties: {
        task: { type: "string", description: "Task description. Either `task` or `taskFile` is required." },
        taskFile: { type: "string", description: "Alternative to `task`: path to a .md/text file." },
        coder: { type: "string" },
        coderModel: { type: "string" },
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
      properties: {
        task: { type: "string", description: "Task description to analyze for gaps. Either `task` or `taskFile` is required." },
        taskFile: { type: "string", description: "Alternative to `task`: path to a .md/text file." },
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
    name: "kj_audit",
    description: "Analyze codebase health without modifying files. Returns findings across security, code quality, performance, architecture, and testing dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Optional focus for the audit. If absent (and no taskFile), defaults to a full-codebase analysis." },
        taskFile: { type: "string", description: "Alternative to `task`: path to a .md/text file with the audit focus." },
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
    name: "kj_clean",
    description: "Garbage-collect stale Karajan state: orphan plans (project dir no longer exists), finalised plans/sessions past their retention window, and HU story batches. Dry-run by default; pass yes=true to actually delete. Use nuke=true to wipe everything (retention=0 on every bucket + drop the HU board SQLite DB).",
    inputSchema: {
      type: "object",
      properties: {
        yes: { type: "boolean", description: "If true, actually delete. Default false (dry-run: returns the list of items that would be removed without touching disk)." },
        nuke: { type: "boolean", description: "If true, retention=0 on every bucket + wipe the HU board DB (stops the board first if running). The \"I want it all gone right now\" button." },
        planDays: { type: "number", description: "Keep finalised plans (approved/rejected/executed) for this many days. Default: 30." },
        draftDays: { type: "number", description: "Keep draft plans for this many days. Default: 60." },
        sessionDays: { type: "number", description: "Keep finalised sessions for this many days. Default: 7." },
        huDays: { type: "number", description: "Keep HU story batches for this many days. Default: 14." }
      }
    }
  },
  {
    name: "kj_rag_query",
    description: "Run a semantic search across the indexed Karajan plans, onboarding briefs and (optionally) project source code. Returns the top-K nearest chunks with their metadata so the agent can quote prior decisions, locate where a concept was last implemented, or pull architectural context without re-walking the repo. The store is empty until `kj_rag_index` (or `kj rag index` CLI) has been run at least once on this project; in that case the response carries `empty: true`.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The natural-language query." },
        topK: { type: "number", description: "Max number of hits to return. Default: 5." },
        scope: { type: "string", description: "Filter by chunk kind: 'plans' | 'code' | 'onboarding' | 'all' (default)." },
        project: { type: "string", description: "Project slug to search. Defaults to the basename of projectDir (same isolation as `kj rag query`); 'all' searches every indexed project." },
        projectDir: { type: "string", description: "Absolute path to the project directory" }
      },
      required: ["text"]
    }
  },
  {
    name: "kj_rag_index",
    description: "(Re)index this project's Karajan-managed assets — every plan-*.json under ~/.karajan/plans/<slug>/ plus the onboarding brief at ~/.karajan/onboarding/<slug>.md — into the local vector store. Idempotent: a re-run replaces the chunks for each source, never appends duplicates. Pass `withSources: true` to also index the project's JS/TS files (skips node_modules / .git / dist / etc.). Required as a one-time bootstrap before kj_rag_query returns anything; safe to re-run after every `kj plan generate`.",
    inputSchema: {
      type: "object",
      properties: {
        withSources: { type: "boolean", description: "Also index .js/.ts files under projectDir. Default false." },
        projectDir: { type: "string", description: "Absolute path to the project directory" }
      }
    }
  }
];
