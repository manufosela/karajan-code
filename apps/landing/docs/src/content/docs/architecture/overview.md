---
title: Architecture Overview
description: High-level architecture of Karajan Code.
---

Karajan Code implements a **Role-Based AI Orchestration** pattern. The system coordinates multiple AI agents through a structured pipeline where each responsibility (coding, reviewing, testing, security) is a discrete, independently configurable role.

## Design Principles

- **Decoupled agent roles.** Each AI capability is a separate role with its own instructions, agent, and model
- **Standardized lifecycle.** All roles implement the same `BaseRole` interface (init, execute, report)
- **CLI-first.** Wraps existing AI agent CLIs (Claude, Codex, Gemini, Aider, OpenCode) instead of calling APIs directly
- **Zero-config.** Auto-detects test frameworks, starts SonarQube, simplifies pipeline for trivial tasks. No per-project configuration required
- **Quality gates.** Static analysis (SonarQube), code review, TDD enforcement, and injection scanning are built-in
- **Solomon as pipeline boss.** Every reviewer rejection is evaluated by Solomon, which overrides style-only blocks and mediates conflicts
- **Injection guard.** Diffs are scanned for prompt injection before reaching the AI reviewer
- **Bootstrap gate.** All prerequisites validated before any tool runs. Fails hard with fix instructions, never silently degrades
- **Fail-fast with escalation.** Repeat detection triggers Solomon arbitration or human intervention
- **Session persistence.** All state is stored on disk for pause/resume and crash recovery
- **Extensible.** Custom agents via plugins, custom rules via markdown files

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLI / MCP / kj-tail                           │
│              (kj run, kj_run tool, kj-tail)                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Bootstrap Gate                                 │
│         (git, remote, config, agents, SonarQube)                 │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Orchestrator                                │
│          (pipeline loop, fail-fast, budget, session)             │
│                                                                  │
│  ┌────────────┐ ┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐   │
│  │HU-Reviewer?│→│ Triage │→│Discover│→│Architect│→│Planner │   │
│  └────────────┘ └────────┘ └────────┘ └─────────┘ └───┬────┘   │
│                                                        │        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │        │
│  │ Commiter │←│  Audit   │←│ Security │←│  Tester  │←─┤        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │        │
│                                                        ▼        │
│                ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│                │ Solomon  │←│ Reviewer │←│  Sonar   │←── Coder  │
│                └────┬─────┘ └──────────┘ └──────────┘           │
│                     │         ▲                                  │
│            override?│    Injection                               │
│             continue│     Guard                                  │
│                     │                                            │
│                approved? ──no──→ loop back to Coder              │
└─────────────────────┬────────────────────────────────────────────┘
                      │
         ┌────────────┼────────────────┐
         ▼            ▼                ▼
  ┌─────────────┐ ┌───────────┐ ┌──────────────┐
  │ Agent Layer │ │  SonarQube │ │ Session Store │
  │ (BaseAgent) │ │  (Docker)  │ │    (disk)     │
  └──────┬──────┘ └───────────┘ └──────────────┘
         │
  ┌──────┴───────────────────────────────────┐
  │ Claude │ Codex │ Gemini │ Aider │ OpenCode │ Plugins
  └──────────────────────────────────────────┘
```

## Module Structure

```
src/
├── cli.js                    # CLI entry point (Commander.js)
├── orchestrator.js           # Main pipeline coordinator
├── bootstrap.js              # Bootstrap gate (prerequisite validation)
├── config.js                 # Config loading & validation
├── session-store.js          # Session persistence (create, pause, resume)
├── session-cleanup.js        # Expired session cleanup
├── repeat-detector.js        # Fail-fast: detect repeated issues
├── activity-log.js           # Session activity logging
│
├── orchestrator/             # Pipeline stage implementations
│   ├── pre-loop-stages.js    #   HU-reviewer, triage, discover, researcher, architect, planner
│   ├── iteration-stages.js   #   Coder, refactorer, guards, TDD, sonar, injection guard, reviewer
│   ├── post-loop-stages.js   #   Tester, security, impeccable, audit
│   ├── stages/               #   Stage sub-modules (split from monolithic stage files)
│   │   ├── triage.js         #     Triage stage logic
│   │   ├── research.js       #     Research stage logic
│   │   ├── architect.js      #     Architect stage logic
│   │   ├── planner.js        #     Planner stage logic
│   │   ├── hu-reviewer.js    #     HU reviewer stage logic
│   │   ├── coder.js          #     Coder stage logic
│   │   ├── sonar.js          #     SonarQube stage logic
│   │   └── reviewer.js       #     Reviewer stage logic
│   ├── preflight-checks.js   #   Pre-run environment validation
│   ├── solomon-escalation.js #   Conflict resolution and escalation
│   ├── solomon-rules.js      #   Solomon's 5 evaluation rules
│   ├── reviewer-fallback.js  #   Fallback reviewer logic
│   ├── agent-fallback.js     #   Fallback agent selection
│   ├── standby.js            #   Rate-limit standby with backoff
│   └── pipeline-context.js   #   Shared pipeline state object
│
├── roles/                    # Role implementations (16 roles)
│   ├── base-role.js          #   Abstract base (init, execute, report)
│   ├── triage-role.js        #   Task complexity classifier
│   ├── discover-role.js      #   Gap detection (Mom Test, Wendel, JTBD)
│   ├── researcher-role.js    #   Codebase investigation
│   ├── architect-role.js     #   Architecture design
│   ├── planner-role.js       #   Implementation planning
│   ├── hu-reviewer-role.js   #   User story certification (6 dimensions, 7 antipatterns)
│   ├── coder-role.js         #   Code & test generation
│   ├── refactorer-role.js    #   Code quality improvement
│   ├── reviewer-role.js      #   Code review
│   ├── tester-role.js        #   Test quality gate
│   ├── security-role.js      #   OWASP security audit
│   ├── impeccable-role.js    #   UI/UX audit (a11y, performance, theming)
│   ├── audit-role.js         #   Read-only codebase health analysis (A-F scores)
│   ├── solomon-role.js       #   Pipeline boss, conflict arbitration
│   ├── sonar-role.js         #   SonarQube (non-AI)
│   ├── commiter-role.js      #   Git automation
│   └── index.js              #   Role registry
│
├── agents/                   # AI agent adapters (5 agents)
│   ├── index.js              #   Agent registry (register, create)
│   ├── base-agent.js         #   Abstract base class
│   ├── claude-agent.js       #   Claude CLI wrapper
│   ├── codex-agent.js        #   Codex CLI wrapper
│   ├── gemini-agent.js       #   Gemini CLI wrapper
│   ├── aider-agent.js        #   Aider CLI wrapper
│   ├── opencode-agent.js     #   OpenCode CLI wrapper
│   ├── host-agent.js         #   Delegate to host AI agent (MCP mode)
│   ├── model-registry.js     #   Model availability & pricing
│   ├── availability.js       #   Check if agents are installed
│   └── resolve-bin.js        #   Resolve agent binary path
│
├── guards/                   # Deterministic guards (no AI)
│   ├── intent-guard.js       #   Validates coder output matches task intent
│   ├── output-guard.js       #   Validates coder output structure
│   ├── perf-guard.js         #   Performance regression detection
│   └── policy-resolver.js    #   Task-type policy resolution
│
├── hu/                       # HU (User Story) system
│   ├── store.js              #   Local HU file storage
│   ├── graph.js              #   Dependency graph with topological sort
│   └── parallel-executor.js  #   Parallel HU execution via git worktrees
│
├── webperf/                  # WebPerf Quality Gate
│   └── runner.js             #   Core Web Vitals measurement via Chrome DevTools
│
├── commands/                 # CLI command handlers
│   ├── run.js, code.js, review.js, plan.js, resume.js
│   ├── audit.js, architect.js, discover.js, researcher.js, triage.js
│   ├── init.js, doctor.js, config.js, report.js, board.js
│   ├── roles.js, agents.js, scan.js, sonar.js
│
├── mcp/                      # MCP server (23 tools)
│   ├── server.js             #   Stdio transport entry point
│   ├── tools.js              #   Tool schemas (23 tools)
│   ├── server-handlers.js    #   Tool handlers
│   ├── handlers/             #   Handler sub-modules (split from server-handlers)
│   │   ├── run.js            #     kj_run handler
│   │   ├── direct.js         #     Direct role handlers (code, review, plan, etc.)
│   │   ├── management.js     #     Management handlers (agents, config, status, etc.)
│   │   └── hu.js             #     HU Board handlers
│   ├── direct-role-runner.js #   Shared boilerplate for standalone role MCP tools
│   ├── run-kj.js             #   Subprocess spawner
│   ├── progress.js           #   Real-time notifications
│   ├── preflight.js          #   MCP preflight validation
│   ├── orphan-guard.js       #   Zombie process prevention
│   └── tool-arg-normalizers.js # Input normalization
│
├── prompts/                  # Prompt builders
│   ├── coder.js              #   Task + feedback + rules
│   ├── reviewer.js           #   Diff + rules
│   ├── planner.js            #   Task + research context
│   ├── architect.js          #   Architecture design prompt
│   ├── triage.js             #   Complexity classification prompt
│   ├── discover.js           #   Gap detection prompt (5 modes)
│   ├── hu-reviewer.js        #   HU certification prompt
│   ├── audit.js              #   Codebase health analysis prompt
│   └── rtk-snippet.js        #   Shared RTK token optimization instructions
│
├── review/                   # Code review infrastructure
│   ├── profiles.js           #   standard/strict/paranoid/relaxed
│   ├── schema.js             #   Reviewer output JSON schema
│   ├── parser.js             #   Parse reviewer response
│   ├── diff-generator.js     #   Git diff generation
│   ├── tdd-policy.js         #   TDD compliance check
│   └── scope-filter.js       #   Defer out-of-scope issues as tech debt
│
├── sonar/                    # SonarQube integration
│   ├── manager.js            #   Docker compose lifecycle (auto-start)
│   ├── scanner.js            #   sonar-scanner execution
│   ├── cloud-scanner.js      #   SonarCloud support
│   ├── api.js                #   REST API client
│   ├── enforcer.js           #   Quality gate enforcement
│   ├── credentials.js        #   Token management (no hardcoded defaults)
│   └── project-key.js        #   Project key detection
│
├── plugins/                  # Plugin system
│   └── loader.js             #   Discover & load plugins
│
├── planning-game/            # Planning Game integration
│   ├── adapter.js            #   Card ID parsing, task enrichment
│   ├── pipeline-adapter.js   #   Event-driven pipeline status updates
│   ├── client.js             #   REST client
│   ├── decomposition.js      #   Task decomposition with linked cards
│   └── architect-adrs.js     #   Auto ADR generation from tradeoffs
│
├── becaria/                  # BecarIA gateway (GitHub PR automation)
│   ├── dispatch.js           #   PR event dispatcher
│   ├── repo.js               #   Repository operations
│   └── pr-diff.js            #   PR diff extraction
│
├── git/                      # Git automation
│   └── automation.js         #   Branch, commit, push, PR
│
└── utils/                    # Shared utilities
    ├── injection-guard.js    #   Prompt injection scanner (directives, unicode, payloads)
    ├── budget.js             #   Token & cost tracking
    ├── pricing.js            #   Model pricing lookup
    ├── model-selector.js     #   Smart model selection per role
    ├── retry.js              #   Exponential backoff
    ├── rate-limit-detector.js #  Rate limit and provider outage detection
    ├── stall-detector.js     #   Agent heartbeat and stall detection
    ├── process.js            #   Subprocess execution
    ├── json-extract.js       #   Robust JSON extraction from agent output
    ├── run-log.js            #   File-based run log for kj-tail
    ├── git.js                #   Git operations
    ├── agent-detect.js       #   Agent binary detection
    ├── project-detect.js     #   Test framework & SonarQube config detection
    ├── rtk-detect.js         #   RTK availability detection
    ├── os-detect.js          #   OS-aware install commands
    ├── events.js             #   Event emission
    ├── display.js            #   CLI formatting (icons, colors, stage output)
    ├── logger.js             #   Logging
    ├── paths.js              #   KJ_HOME resolution
    ├── wizard.js             #   Interactive prompts
    └── fs.js                 #   File system helpers

templates/
├── roles/                    # Role instruction files (.md)
│   ├── coder.md, reviewer.md, planner.md, architect.md
│   ├── triage.md, discover.md, researcher.md, hu-reviewer.md
│   ├── tester.md, security.md, solomon.md, sonar.md
│   ├── impeccable.md, audit.md, commiter.md, refactorer.md
│   └── reviewer-strict.md, reviewer-paranoid.md, reviewer-relaxed.md
└── skills/                   # Skill definitions for MCP tools
    ├── kj-run.md, kj-code.md, kj-review.md, kj-audit.md
    ├── kj-discover.md, kj-architect.md, kj-security.md
    ├── kj-test.md, kj-sonar.md, kj-board.md

packages/
└── hu-board/                 # HU Board dashboard (standalone app)
    ├── src/server.js         #   Express server
    ├── src/db.js             #   SQLite storage
    ├── src/sync.js           #   File watcher (chokidar)
    ├── src/routes/api.js     #   REST API
    ├── public/               #   Vanilla JS frontend (kanban, sessions)
    └── Dockerfile            #   Docker deployment
```

## Core Abstractions

### BaseRole

Every pipeline role extends `BaseRole`. This provides a uniform lifecycle:

```javascript
class BaseRole {
  constructor({ name, config, logger, emitter })
  async init(context)       // Load instructions from .md template
  async execute(input)      // Role-specific logic
  async run(input)          // Wrapper: init, execute, validate, emit events
  report()                  // { role, ok, result, summary, timestamp }
}
```

Role instructions are loaded from markdown files in priority order:
1. Project override: `.karajan/roles/<role>.md`
2. User override: `~/.karajan/roles/<role>.md`
3. Built-in default: `templates/roles/<role>.md`

### BaseAgent

Every AI agent adapter extends `BaseAgent`:

```javascript
class BaseAgent {
  constructor(name, config, logger)
  async runTask(task)       // Execute coding/planning task
  async reviewTask(task)    // Execute review task
  getRoleModel(role)        // Get configured model for role
}
```

Agents wrap CLI tools as subprocesses. The agent registry allows registration at startup (built-in) or via plugins (custom).

### Agent Registry

```javascript
registerAgent("claude", ClaudeAgent, { bin: "claude", installUrl: "..." })
const agent = createAgent("claude", config, logger)
const result = await agent.runTask({ prompt, role: "coder" })
```

### Orchestrator

The orchestrator drives the full pipeline through three phases:

1. **Pre-loop.** Bootstrap gate, HU-reviewer, triage, discover, researcher, architect, planner
2. **Iteration loop.** Coder, refactorer, guards, TDD check, sonar, injection guard, reviewer, Solomon (repeats until approved or max iterations)
3. **Post-loop.** Tester, security, impeccable, audit, commiter (only after approval)

## Pipeline Flow

```
Input (task description)
    │
    ▼
┌─ Bootstrap Gate ───────────┐
│  Validate: git, remote,    │
│  config, agents, sonar     │
└────────────┬───────────────┘
    │
    ▼
┌─ Pre-loop ─────────────────────┐
│  [HU-Reviewer?] → certify HU  │
│  [Triage]       → classify     │
│  [Discover?]    → detect gaps  │
│  [Researcher?]  → investigate  │
│  [Architect?]   → design       │
│  [Planner?]     → plan steps   │
└────────────────────────────────┘
    │
    ▼
┌─ Iteration Loop (1..N) ─────────────────────────────────┐
│                                                          │
│  [Coder]          → write code & tests                  │
│  [Refactorer?]    → improve clarity                     │
│  [Guards]         → intent + output + perf checks       │
│  [TDD Check]      → enforce test changes                │
│  [SonarQube?]     → static analysis + quality gate      │
│  [Impeccable?]    → UI/UX audit (frontend tasks)        │
│  [Injection Guard] → scan diff for prompt injection     │
│  [Reviewer]       → code review                         │
│       ├→ approved   → exit loop                         │
│       └→ rejected   → Solomon evaluates                 │
│  [Solomon]        → override style-only? continue? stop?│
│       ├→ continue   → loop back with conditions         │
│       ├→ override   → approve despite reviewer          │
│       └→ escalate   → human intervention                │
│                                                          │
└──────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Post-loop ────────────────────┐
│  [Tester?]     → test quality  │
│  [Security?]   → OWASP audit   │
│  [Audit]       → certify code  │
│  [Commiter?]   → git finalize  │
└────────────────────────────────┘
    │
    ▼
Result (session report, budget, commits)
```

## Configuration Resolution

Config is loaded and merged in this order:

1. **Built-in defaults** in `config.js`
2. **User config** at `~/.karajan/kj.config.yml` (or `$KJ_HOME/kj.config.yml`)
3. **Project config** at `.karajan.yml` in project root
4. **Product context** at `.karajan/context.md` (injected into all role prompts)
5. **CLI flags** override everything

Model selection follows a similar hierarchy:
```
roles.<role>.model → <role>_options.model → agent default
```

## Session Lifecycle

```
create → running → [pause?] → approved | failed
                       ↓
                    paused → resume → running
```

Sessions are persisted to `~/.karajan/sessions/{sessionId}/session.json` and include:
- Task description and config snapshot
- Checkpoints per stage (timestamp, iteration, notes)
- Reviewer feedback history
- Budget tracking (tokens, estimated costs)
- Pause state (question, context, answer)

This enables crash recovery, pause/resume, and post-run reporting.

## Inspirations

The architecture draws from several sources:

- **[jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration)** Clean hexagonal architecture with ports and adapters for AI orchestration. Influenced Karajan's agent adapter design and role abstraction.
- **Hexagonal Architecture (Ports & Adapters).** The agent layer acts as adapters (Claude, Codex, etc.) behind a unified port (`BaseAgent`).
- **Pipeline Pattern.** The orchestrator composes roles into a configurable, iterative pipeline with quality gates.
- **Event-Driven Architecture.** Roles emit events for progress tracking, MCP notifications, and kj-tail real-time monitoring.
