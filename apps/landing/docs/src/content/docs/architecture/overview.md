---
title: Architecture Overview
description: High-level architecture of Karajan Code.
---

Karajan Code implements a **Role-Based AI Orchestration** pattern. The system coordinates multiple AI agents through a structured pipeline where each responsibility (coding, reviewing, testing, security) is a discrete, independently configurable role.

## Design Principles

- **Decoupled agent roles** — Each AI capability is a separate role with its own instructions, agent, and model
- **Standardized lifecycle** — All roles implement the same `BaseRole` interface (init → execute → report)
- **CLI-first** — Wraps existing AI agent CLIs (Claude, Codex, Gemini, Aider) instead of calling APIs directly
- **Quality gates** — Static analysis (SonarQube), code review, and TDD enforcement are built-in
- **Fail-fast with escalation** — Repeat detection triggers Solomon arbitration or human intervention
- **Session persistence** — All state is stored on disk for pause/resume and crash recovery
- **Extensible** — Custom agents via plugins, custom rules via markdown files

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI / MCP                           │
│                   (kj run, kj_run tool)                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      Orchestrator                           │
│            (pipeline loop, fail-fast, budget)                │
│                                                             │
│  ┌────────┐ ┌──────────┐ ┌─────────┐ ┌────────┐ ┌────────┐  │
│  │ Triage │→│Researcher│→│Architect│→│Planner │→│ Coder  │  │
│  └────────┘ └──────────┘ └─────────┘ └────────┘ └───┬────┘  │
│                                                  │         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │         │
│  │ Commiter │← │ Security │← │  Tester  │←──────┤         │
│  └──────────┘  └──────────┘  └──────────┘       │         │
│                                                  ▼         │
│                              ┌──────────┐  ┌──────────┐   │
│                              │ Reviewer │← │  Sonar   │   │
│                              └────┬─────┘  └──────────┘   │
│                                   │                        │
│                          approved? ──no──→ loop back       │
└───────────────────────────┬─────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
    ┌─────────────┐  ┌───────────┐  ┌──────────────┐
    │ Agent Layer │  │  SonarQube │  │ Session Store │
    │ (BaseAgent) │  │  (Docker)  │  │    (disk)     │
    └──────┬──────┘  └───────────┘  └──────────────┘
           │
    ┌──────┴──────────────────────────┐
    │   Claude │ Codex │ Gemini │ Aider │ Plugins
    └─────────────────────────────────┘
```

## Module Structure

```
src/
├── cli.js                    # CLI entry point (Commander.js)
├── orchestrator.js           # Main pipeline coordinator
├── config.js                 # Config loading & validation
├── session-store.js          # Session persistence (create, pause, resume)
├── repeat-detector.js        # Fail-fast: detect repeated issues
├── activity-log.js           # Session activity logging
│
├── orchestrator/             # Pipeline stage implementations
│   ├── pre-loop-stages.js    #   Triage, researcher, architect, planner
│   ├── iteration-stages.js   #   Coder, refactorer, TDD, sonar, reviewer
│   ├── post-loop-stages.js   #   Tester, security
│   ├── reviewer-fallback.js  #   Fallback reviewer logic
│   └── solomon-escalation.js #   Conflict resolution
│
├── roles/                    # Role implementations
│   ├── base-role.js          #   Abstract base (init → execute → report)
│   ├── coder-role.js         #   Code & test generation
│   ├── reviewer-role.js      #   Code review
│   ├── planner-role.js       #   Implementation planning
│   ├── refactorer-role.js    #   Code quality improvement
│   ├── tester-role.js        #   Test quality gate
│   ├── security-role.js      #   OWASP security audit
│   ├── researcher-role.js    #   Codebase investigation
│   ├── solomon-role.js       #   Conflict arbitration
│   ├── sonar-role.js         #   SonarQube (non-AI)
│   ├── triage-role.js        #   Task complexity classifier
│   ├── architect-role.js     #   Architecture design
│   └── commiter-role.js      #   Git automation
│
├── agents/                   # AI agent adapters
│   ├── index.js              #   Agent registry (register, create)
│   ├── base-agent.js         #   Abstract base class
│   ├── claude-agent.js       #   Claude CLI wrapper
│   ├── codex-agent.js        #   Codex CLI wrapper
│   ├── gemini-agent.js       #   Gemini CLI wrapper
│   ├── aider-agent.js        #   Aider CLI wrapper
│   ├── model-registry.js     #   Model availability & pricing
│   ├── availability.js       #   Check if agents are installed
│   └── resolve-bin.js        #   Resolve agent binary path
│
├── commands/                 # CLI command handlers
│   ├── run.js, code.js, review.js, plan.js, resume.js
│   ├── init.js, doctor.js, config.js, report.js
│   ├── roles.js, scan.js, sonar.js
│
├── mcp/                      # MCP server
│   ├── server.js             #   Stdio transport entry point
│   ├── tools.js              #   Tool schemas
│   ├── server-handlers.js    #   Tool handlers
│   ├── run-kj.js             #   Subprocess spawner
│   ├── progress.js           #   Real-time notifications
│   └── orphan-guard.js       #   Zombie process prevention
│
├── prompts/                  # Prompt builders
│   ├── coder.js              #   Task + feedback + rules
│   ├── reviewer.js           #   Diff + rules
│   ├── planner.js            #   Task + research context
│   └── architect.js          #   Architecture design prompt
│
├── review/                   # Code review infrastructure
│   ├── profiles.js           #   standard/strict/paranoid/relaxed
│   ├── schema.js             #   Reviewer output JSON schema
│   ├── parser.js             #   Parse reviewer response
│   ├── diff-generator.js     #   Git diff generation
│   └── tdd-policy.js         #   TDD compliance check
│
├── sonar/                    # SonarQube integration
│   ├── manager.js            #   Docker compose lifecycle
│   ├── scanner.js            #   sonar-scanner execution
│   ├── api.js                #   REST API client
│   ├── enforcer.js           #   Quality gate enforcement
│   └── project-key.js        #   Project key detection
│
├── plugins/                  # Plugin system
│   └── loader.js             #   Discover & load plugins
│
├── planning-game/            # Planning Game integration
│   ├── adapter.js            #   Card ID parsing, task enrichment
│   ├── client.js             #   REST client
│   └── architect-adrs.js     #   Auto ADR generation from tradeoffs
│
├── git/                      # Git automation
│   └── automation.js         #   Branch, commit, push, PR
│
└── utils/                    # Shared utilities
    ├── budget.js             #   Token & cost tracking
    ├── pricing.js            #   Model pricing lookup
    ├── retry.js              #   Exponential backoff
    ├── process.js            #   Subprocess execution
    ├── git.js                #   Git operations
    ├── events.js             #   Event emission
    ├── display.js            #   CLI formatting
    ├── logger.js             #   Logging
    ├── paths.js              #   KJ_HOME resolution
    └── fs.js                 #   File system helpers

templates/
└── roles/                    # Role instruction files (.md)
    ├── coder.md, reviewer.md, planner.md, architect.md, ...
    ├── reviewer-strict.md, reviewer-paranoid.md, reviewer-relaxed.md
```

## Core Abstractions

### BaseRole

Every pipeline role extends `BaseRole`. This provides a uniform lifecycle:

```javascript
class BaseRole {
  constructor({ name, config, logger, emitter })
  async init(context)       // Load instructions from .md template
  async execute(input)      // Role-specific logic
  async run(input)          // Wrapper: init → execute → validate → emit events
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

1. **Pre-loop** — intent classifier, triage, researcher, architect, planner (optional)
2. **Iteration loop** — coder → refactorer → guards → TDD check → sonar → reviewer (repeats until approved or max iterations)
3. **Post-loop** — tester, security, git finalize (only after approval)

## Pipeline Flow

```
Input (task description)
    │
    ▼
┌─ Pre-loop ──────────────────┐
│  [Intent?]     → classify   │
│  [Triage?]     → complexity │
│  [Researcher?] → investigate│
│  [Architect?]  → design     │
│  [Planner?]    → plan       │
└─────────────────────────────┘
    │
    ▼
┌─ Iteration Loop (1..N) ────────────────────────────┐
│                                                     │
│  [Coder]      → write code & tests                 │
│  [Refactorer?] → improve clarity                    │
│  [Guards]     → output + perf checks               │
│  [TDD Check]  → enforce test changes               │
│  [SonarQube?] → static analysis + quality gate      │
│       └→ repeat detected? → pause/escalate          │
│  [Reviewer]   → code review                         │
│       ├→ approved  → exit loop ✓                    │
│       ├→ rejected  → retry with feedback            │
│       └→ max retries → Solomon? → human escalation  │
│                                                     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─ Post-loop ─────────────────┐
│  [Tester?]   → test quality │
│  [Security?] → OWASP audit  │
│  [Commiter?] → git finalize │
└─────────────────────────────┘
    │
    ▼
Result (session report, budget, commits)
```

## Configuration Resolution

Config is loaded and merged in this order:

1. **Built-in defaults** — hardcoded in `config.js`
2. **User config** — `~/.karajan/kj.config.yml` (or `$KJ_HOME/kj.config.yml`)
3. **Project config** — `.karajan.yml` in project root (pricing overrides)
4. **CLI flags** — command-line arguments override everything

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

- **[jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration)** — Clean hexagonal architecture with ports and adapters for AI orchestration. Influenced Karajan's agent adapter design and role abstraction.
- **Hexagonal Architecture (Ports & Adapters)** — The agent layer acts as adapters (Claude, Codex, etc.) behind a unified port (`BaseAgent`).
- **Pipeline Pattern** — The orchestrator composes roles into a configurable, iterative pipeline with quality gates.
- **Event-Driven Architecture** — Roles emit events for progress tracking and MCP notifications.
