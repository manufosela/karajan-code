---
title: Architecture History
description: How Karajan Code's architecture has evolved over time.
---

This page documents the major architectural decisions and how Karajan Code evolved from a simple shell script orchestrator to a modular, multi-agent pipeline.

## Phase 1: Simple Orchestrator (v0.x)

**What it was:** A single script that ran Claude CLI on a task, then ran Codex CLI to review the output. No config, no sessions, no quality gates.

**Architecture:**
```
task → claude → diff → codex review → done
```

**Limitations:**
- Hardcoded to two agents (Claude + Codex)
- No retry on failure
- No cost tracking
- No SonarQube or testing integration
- Monolithic script, hard to extend

## Phase 2: Quality Gates (v1.0)

**What changed:** Added SonarQube static analysis as a mandatory step between coding and reviewing. Added TDD enforcement to ensure tests are written alongside code.

**Key additions:**
- SonarQube Docker integration (auto-start, scan, quality gate enforcement)
- TDD policy check (source changes require test changes)
- Configuration file (`kj.config.yml`) with first defaults
- Session tracking (basic run metadata)

**Architecture:**
```
task → coder → sonar → reviewer → done
                         ↑          │
                         └── loop ──┘
```

**Why:** Raw AI-generated code without quality gates often introduced code smells, skipped tests, or had security issues. SonarQube provided an objective, automated quality check independent of the reviewer.

## Phase 3: Role-Based Pipeline (v1.1)

**What changed:** Refactored from a monolithic orchestrator to a role-based architecture. Each pipeline responsibility became a discrete role with its own instructions, agent, and model.

**Key additions:**
- `BaseRole` abstraction (init → execute → report lifecycle)
- `BaseAgent` abstraction (uniform interface for all CLI agents)
- Agent registry (register, create, resolve)
- 11 configurable roles: triage, researcher, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter
- Review profiles (standard, strict, paranoid, relaxed)
- Role instructions as markdown templates (overridable)
- Repeat detection and fail-fast logic
- Solomon escalation for conflict resolution
- Budget tracking with estimated costs

**Architecture:**
```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer
                                                                      ↓
                                                         tester? → security? → commiter?
```

**Why:** The monolithic orchestrator had become difficult to maintain and extend. Adding a new capability (like security audits) meant modifying the core loop. The role-based pattern made each responsibility independently testable and configurable.

**Inspiration:** [jorgecasar/legacy-s-end-2/packages/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) uses a clean hexagonal architecture with:
- **Domain layer**: Models and port interfaces
- **Use-cases**: plan-issue, implement-issue, review-pr, check-task-readiness, track-cost-report
- **Infrastructure**: Adapters for Anthropic, Gemini, OpenAI, GitHub, GitCli

This influenced Karajan's separation between the agent interface (`BaseAgent` as port) and concrete implementations (Claude, Codex, Gemini, Aider as adapters). The role system parallels the use-case layer — each role is a self-contained orchestration unit.

## Phase 4: MCP Server (v1.2)

**What changed:** Added a Model Context Protocol (MCP) server so Karajan can be used from within AI agents (Claude Code, Codex) rather than only from the terminal.

**Key additions:**
- MCP stdio server with 11 tools (kj_run, kj_code, kj_review, etc.)
- Real-time progress notifications via MCP logging
- Auto-registration in Claude Code and Codex
- Orphan guard to prevent zombie processes
- Session pause/resume via MCP (`kj_resume`)

**Architecture addition:**
```
┌──────────────────┐
│ AI Agent (Claude) │
│                  │──── MCP (stdio) ────→ karajan-mcp ──→ CLI subprocess
│                  │←─── progress/result ─┘
└──────────────────┘
```

**Why:** The most powerful way to use Karajan is not from the terminal, but from within an AI agent's conversation. The MCP server lets Claude or Codex delegate complex tasks to Karajan's pipeline, receive real-time progress updates, and get structured results — all without leaving the conversation.

## Phase 5: Extensibility (v1.3)

**What changed:** Plugin system, Planning Game integration, and production hardening.

**Key additions:**
- Plugin system: `.karajan/plugins/*.js` for custom agents
- Planning Game MCP integration (card enrichment, status updates)
- Retry with exponential backoff and jitter
- Session cleanup (auto-expire old sessions)
- Git automation (auto-commit, auto-push, auto-PR, auto-rebase)
- Reviewer fallback chain (primary → fallback → Solomon)
- Environment variable overrides (`KJ_HOME`, `KJ_SONAR_TOKEN`)

**Why:** Users needed to integrate Karajan into their existing workflows — project management (Planning Game), custom AI tools (plugins), and CI/CD (git automation). The plugin system was particularly important: it allows anyone to wrap their own CLI tool as a Karajan agent without modifying the core codebase.

## Phase 6: Resilience (v1.4)

**What changed:** Automatic detection and handling of CLI agent rate limits, with seamless fallback to alternative agents.

**Key additions:**
- Rate limit detection: pattern matching on agent stderr/stdout for all supported agents (Claude, Codex, Gemini, Aider)
- Session pause on rate limit instead of failure — resume with `kj resume` when the token window resets
- Auto-fallback: when the primary coder agent hits a rate limit, automatically switch to a configured fallback agent
- `--coder-fallback` CLI flag and `coder_options.fallback_coder` config option
- Checkpoint tracking for each fallback attempt

**Architecture addition:**
```
coder (primary) ──rate limit──→ coder (fallback) ──rate limit──→ session pause
       │                              │
       ok                             ok
       ↓                              ↓
    continue                       continue
```

**Why:** CLI agents running under subscription plans (Claude Pro, Codex, etc.) can hit usage caps mid-pipeline. Previously this caused the session to fail, losing progress. Now Karajan detects rate limits, tries an alternative agent, and only pauses as a last resort — preserving session state for seamless resumption.

## Phase 7: Smart Model Selection (v1.5)

**What changed:** Automatic model selection per role based on triage complexity — lighter models for trivial tasks, powerful models for complex ones.

**Key additions:**
- Smart model selection: triage classifies complexity (trivial/simple/medium/complex), then `model-selector.js` maps each role to the optimal model
- Default tier map: trivial → haiku/flash/o4-mini, complex → opus/pro/o3
- Role overrides: reviewer always uses at least "medium" tier for quality; triage always uses lightweight models
- Explicit CLI flags (`--coder-model`, `--reviewer-model`) always take precedence over smart selection
- CLI flags: `--smart-models` / `--no-smart-models`
- MCP parameter: `smartModels` for `kj_run`
- User-configurable tiers and role overrides via `model_selection` in `kj.config.yml`

**Architecture addition:**
```
triage → level ("simple")
       → model-selector → { coder: "claude/haiku", reviewer: "claude/sonnet" }
       → config.roles.*.model populated (only null slots — CLI flags win)
       → agents pass --model flag as usual
```

**Why:** Not all tasks deserve the most powerful (and slowest) model. A typo fix doesn't need Opus, and a complex refactor shouldn't use Haiku. Smart selection optimizes three things: speed (lighter models respond faster), quality (complex tasks get powerful models), and token quota usage (lighter models consume less of your subscription window, reducing rate limit risk).

## Phase 8: Interactive Checkpoints & Task Decomposition (v1.6)

**What changed:** Replaced the hard timeout that killed running processes with an interactive checkpoint system, and added automatic task decomposition with Planning Game integration.

**Key additions:**
- Interactive checkpoints: every 5 minutes (configurable with `--checkpoint-interval`), pauses execution with a progress report and asks the user to continue (5 more min / until done / custom time / stop)
- Only applies when `askQuestion` is available (MCP `kj_run`); subprocess commands (`kj_code`, `kj_review`) run without timeout by default
- Triage task decomposition: analyzes whether tasks should be split, returning `shouldDecompose` and `subtasks[]` fields
- PG subtask creation: when triage recommends decomposition and a Planning Game card is linked, creates subtask cards with `blocks/blockedBy` chain relationships
- Planner receives decomposition context, focusing on the first subtask
- PR body enrichment with approach, steps, and pending subtasks as checkboxes
- Provider and model tracking in all session checkpoints

**Architecture addition:**
```
MCP kj_run:
  iteration loop
    ├── checkpoint timer (every N min)
    │     └── askQuestion → continue / stop / adjust
    ├── coder → sonar → reviewer
    └── next iteration

Triage decomposition:
  triage → shouldDecompose: true, subtasks: [...]
         → askQuestion("Create PG subtasks?")
         → PG API: createCard × N → relateCards (blocks chain)
```

**Why:** The hard timeout was a blunt instrument — it killed the process regardless of progress, losing all work. Interactive checkpoints give the user control: see what's been done, decide whether to continue, and adjust timing. Task decomposition prevents overloading a single pipeline run with work that should be multiple sequential tasks.

## Phase 9: In-Process MCP Handlers (v1.7)

**What changed:** Moved `kj_code`, `kj_review`, and `kj_plan` from subprocess execution to in-process execution within the MCP server, and added automatic version-based restart.

**Key additions:**
- In-process execution: `kj_code`, `kj_review`, `kj_plan` now run inside the MCP server process (like `kj_run`), eliminating subprocess timeouts that killed tasks via SIGKILL
- Version watcher: `setupVersionWatcher` detects `package.json` version changes after `npm link`/`npm install` and exits cleanly so the MCP host restarts with fresh code
- Per-call version check as fallback for the watcher
- Dynamic version reads from `package.json` instead of hardcoded strings

**Why:** The subprocess model imposed a timeout via execa that killed agents mid-work with SIGKILL. In-process execution gives agents unlimited time — the orchestrator manages lifecycle, not the process manager. The version watcher solved a painful development issue: ESM module caching meant the MCP server kept running old code after updates.

## Phase 10: Pipeline Stage Tracker (v1.8)

**What changed:** Added cumulative pipeline progress tracking — a single event showing the full state of all stages after every transition.

**Key additions:**
- `pipeline:tracker` event emitted after every stage transition during `kj_run`, with cumulative state (done/running/pending/failed) for all pipeline stages
- Single-agent progress logging: `kj_code`, `kj_review`, `kj_plan` emit tracker start/end logs so MCP hosts can show which agent is active
- CLI rendering: `kj run` displays a cumulative pipeline box with status icons per stage
- `buildPipelineTracker(config, emitter)` builds stage list from config and self-registers on the event emitter
- `sendTrackerLog(server, stageName, status, summary)` helper for single-agent handlers

**Architecture addition:**
```
kj_run pipeline events (before v1.8):
  coder:start → coder:end → sonar:start → sonar:end → reviewer:start → ...
  (host must reconstruct state from individual events)

kj_run pipeline events (v1.8+):
  coder:start → pipeline:tracker { stages: [{coder: running}, {sonar: pending}, ...] }
  coder:end   → pipeline:tracker { stages: [{coder: done}, {sonar: pending}, ...] }
  sonar:start → pipeline:tracker { stages: [{coder: done}, {sonar: running}, ...] }
  (host receives full state in every event — no reconstruction needed)
```

**Why:** MCP hosts received individual `*:start`/`*:end` events but had no cumulative view. Each host had to maintain its own state machine to reconstruct pipeline progress. The tracker centralizes this logic — one event, one snapshot, zero host-side state management. For single-agent tools (`kj_code`/`kj_review`/`kj_plan`), there was previously zero progress feedback; now hosts see start/end tracker logs.

## Phase 11: Planner Reliability & MCP Lifecycle Hardening (v1.9 - v1.9.6)

**What changed:** Strengthened `kj_plan` anti-hang behavior and clarified MCP lifecycle during upgrades.

**Key additions:**
- Planner guardrails promoted and documented: `session.max_agent_silence_minutes` and `session.max_planner_minutes` prevent silent or runaway planning executions
- Better planner diagnostics in MCP responses/logs: clearer failure categories and actionable suggestions when stalls/timeouts happen
- MCP lifecycle hardening for upgrades: stale server processes exit after version changes so hosts reconnect with fresh code instead of running mixed versions
- Operational troubleshooting guidance added for the expected `Transport closed` scenario after updates
- Branch guard for MCP tools: `kj_run`, `kj_code`, and `kj_review` reject execution when on the base branch to avoid empty diffs (v1.9.4)
- Claude subprocess compatibility: strips `CLAUDECODE` env var, detaches stdin, and reads structured output from stderr where Claude Code 2.x writes it (v1.9.5-v1.9.6)

**Architecture addition:**
```
MCP host session (old process)
    └─ package version changes
        └─ stale karajan-mcp exits
            └─ host reconnects and spawns fresh version
```

**Why:** Long planning prompts can look "stuck" when an agent stays silent for too long, and upgrades can leave MCP hosts attached to stale processes. v1.9.x also focused on operational reliability: fail fast with useful diagnostics, and make MCP process lifecycle predictable after version bumps.

## Phase 12: Runtime Agent Management & Session Resilience (v1.10.0)

**What changed:** Added runtime agent swapping per pipeline role, expanded session resumability, and hardened subprocess reliability.

**Key additions:**
- `kj_agents` MCP tool and `kj agents` CLI command: list or set the AI agent per pipeline role on the fly (`kj agents set coder gemini`), persists to `kj.config.yml`, no restart needed
- Checkpoint resilience: null/empty `elicitInput` response defaults to "continue 5 min" instead of killing the session
- `kj_resume` expanded: now accepts stopped and failed sessions, not just paused ones
- Subprocess constraints: coder prompt tells the agent it is non-interactive — use `--yes`/`--no-input` flags or report inability
- `kj doctor` version: shows Karajan Code version as first check line
- 1084 tests total
- Planning Game auto-status (v1.10.1): when `kj_run` has a `pgTaskId`, automatically marks the card as "In Progress" at start and "To Validate" on completion — works from both CLI and MCP
- 1090 tests total (v1.10.1)

**Architecture addition:**
```
kj agents set coder gemini
    └─ update kj.config.yml (roles.coder.agent = "gemini")
    └─ next kj_run / kj_code picks up new agent — no MCP restart

kj_resume (v1.10.0):
    paused sessions  ──→ resume (as before)
    stopped sessions ──→ resume (new)
    failed sessions  ──→ resume (new)
```

**Why:** Users needed to switch agents mid-session without restarting the MCP server or editing config files manually. The expanded `kj_resume` means sessions that stopped or failed due to transient issues (rate limits, network errors) can be recovered instead of abandoned. Subprocess constraints prevent agents from hanging on interactive prompts that will never receive input.

## Phase 13: Pipeline Intelligence & Human Sovereignty (v1.11.0)

**What changed:** Transformed from a passive pipeline executor into an intelligent orchestrator with human-first governance. Triage, tester, security, and Solomon are now on by default. Preflight handshake prevents AI agents from overriding human config decisions.

**Key additions:**
- Triage as pipeline director: analyzes task complexity and returns JSON with role activation decisions per task
- Tester and security enabled by default — every task gets tested and security-audited
- Solomon supervisor: runs after each iteration with 4 built-in rules (max_files, stale_iterations, dependency_guard, scope_guard), pauses on critical alerts
- Preflight handshake (`kj_preflight`): mandatory human confirmation before `kj_run`/`kj_code` executes — blocks AI from changing agents silently
- Session-scoped agent config: `kj_agents` via MCP defaults to session scope (in-memory), CLI defaults to project scope
- 3-tier config merge: DEFAULTS < global (`~/.karajan/`) < project (`.karajan/`)
- Rate-limit standby with auto-retry: parses cooldown from 5 error patterns, waits with exponential backoff (5min default, 30min max), emits standby/heartbeat/resume events, max 5 retries before human pause
- MCP progress streaming extended to `kj_code`, `kj_review`, `kj_plan` (was only `kj_run`)
- Enhanced `kj_status`: parsed status summary (currentStage, currentAgent, iteration, isRunning, errors)
- `kj-tail` resilient tracking with `tail -F`
- 1180 tests across 106 files

**Architecture addition:**
```
Before v1.11.0:
  AI calls kj_run(coder: "codex") → Karajan runs codex, no questions asked

After v1.11.0:
  AI calls kj_run → BLOCKED (preflight required)
  AI calls kj_preflight → shows config to human → human says "ok" or adjusts
  AI calls kj_run → triage evaluates task → activates roles → coder → solomon check → reviewer → tester → security

Rate-limit standby:
  coder hits rate limit → parse cooldown → wait (backoff) → retry same iteration
  5 consecutive retries → pause for human

Solomon supervisor:
  after each iteration → evaluate 4 rules → warning/critical
  critical → pause + ask human via elicitInput
```

**Why:** Running AI-generated code without testing or security checks was unacceptable ("vaya mierda de código"). Triage as director ensures the right roles activate for each task's complexity. The preflight handshake solved a fundamental trust issue: when an AI agent passes `coder: "codex"` to `kj_run`, there was no way to know if the human chose that or the AI decided on its own. Now the human explicitly confirms or adjusts before anything runs.

## Phase 14: Intelligent Reviewer Mediation (v1.12.0)

**What changed:** The pipeline now intelligently handles reviewer blocking issues that fall outside the current diff's scope, instead of stalling or stopping.

**Key additions:**
- Reviewer scope filter: automatically detects when a reviewer raises blocking issues about files not in the current diff
- Deferred issues tracking: out-of-scope blocking issues are auto-deferred and stored in the session's `deferredIssues` field as tech debt
- Coder feedback loop: deferred issues are fed back into the coder prompt on subsequent iterations for awareness
- Solomon `reviewer_overreach` rule: 5th built-in rule that detects when a reviewer is blocking on out-of-scope files
- Solomon reviewer mediation: instead of immediately stopping on reviewer stalls, Solomon evaluates and mediates

**Architecture addition:**
```
Reviewer raises blocking issue on file outside diff:
  scope filter → issue is out-of-scope
    → auto-defer (pipeline continues)
    → store in session.deferredIssues
    → inject into next coder prompt as tech debt context

Solomon mediation (reviewer stall):
  reviewer blocks → Solomon evaluates → overreach? → defer + continue
                                       → legitimate? → pause for human
```

**Why:** Reviewers frequently flag pre-existing problems in files the coder never touched, causing the pipeline to loop indefinitely on issues that cannot be resolved within the current task's scope. The scope filter breaks this loop by deferring out-of-scope issues while preserving them as tracked tech debt. Solomon's mediation role ensures the pipeline is resilient to reviewer overreach without losing visibility into legitimate concerns.

## Phase 15: BecarIA Gateway (v1.13.0)

**What changed:** Full CI/CD integration with GitHub PRs as the single source of truth. All pipeline agents now post their results directly on PRs, and the pipeline creates PRs early in the process.

**Key additions:**
- BecarIA Gateway: GitHub PRs become the central coordination point for all agents
- Early PR creation: draft PR created after the first coder iteration
- Agent PR comments/reviews: all agents (Coder, Reviewer, Sonar, Solomon, Tester, Security, Planner) post results as PR comments or reviews
- Configurable dispatch events via `becaria` config section — trigger GitHub Actions workflows at each pipeline stage
- `kj review` standalone with PR diff support — usable as an independent code review tool
- Embedded workflow templates: `kj init --scaffold-becaria` generates `becaria-gateway.yml`, `automerge.yml`, `houston-override.yml`
- `kj doctor` BecarIA checks: verifies workflow templates and GitHub token permissions
- `--enable-becaria` CLI flag and `enableBecaria` MCP parameter

**Architecture addition:**
```
Before v1.13.0 (local pipeline):
  coder → sonar → reviewer → commiter → manual PR creation

After v1.13.0 (BecarIA Gateway):
  coder (iteration 1) → create draft PR
  coder → post comment on PR
  sonar → post comment on PR
  reviewer → post review on PR
  solomon → post comment on PR
  tester → post comment on PR
  security → post comment on PR
  dispatch events → GitHub Actions workflows

kj init --scaffold-becaria:
  → .github/workflows/becaria-gateway.yml
  → .github/workflows/automerge.yml
  → .github/workflows/houston-override.yml
```

**Why:** Local-only pipelines required manual steps to bridge the gap between AI-generated code and team collaboration. PRs are the natural collaboration point for code review and CI/CD, but creating them was a manual afterthought. BecarIA Gateway makes PRs the first-class integration point: agents post their findings where the team already works, dispatch events trigger existing CI/CD workflows, and the early PR creation ensures visibility from the first iteration. This transforms Karajan from a local orchestrator into a CI/CD-aware pipeline that integrates seamlessly with GitHub-based workflows.

## Phase 16: Policy-Driven Pipeline (v1.14.0)

**What changed:** The pipeline now dynamically enables or disables stages based on task type, replacing the one-size-fits-all approach with policy-driven configuration.

**Key additions:**
- New `src/guards/policy-resolver.js` module: maps each `taskType` to a set of pipeline policies (tdd, sonar, reviewer, testsRequired)
- 5 built-in task types: `sw` (software), `infra`, `doc`, `add-tests`, `refactor` — each with appropriate stage defaults
- Config overrides via `policies` section in `kj.config.yml` — projects can customize which stages apply per task type
- Orchestrator applies policy gates with config immutability: shallow copies ensure the caller's configuration is never mutated
- `policies:resolved` event emitted after resolution, enabling downstream consumers to react to the active policy set
- Unknown or missing `taskType` defaults to `sw` (most conservative)
- Mandatory triage with taskType classification (v1.15.0)
- `--taskType` CLI/MCP parameter for explicit override
- Triage → policy-resolver integration chain

**Architecture addition:**
```
Before v1.14.0:
  kj_run → all stages enabled based on static config
  infra task → TDD check fails → pipeline stalls on irrelevant gate

After v1.14.0:
  kj_run(taskType: "infra") → policy-resolver → { tdd: false, sonar: false, reviewer: true }
  kj_run(taskType: "sw")    → policy-resolver → { tdd: true, sonar: true, reviewer: true }
  kj_run(taskType: null)    → policy-resolver → defaults to "sw" (most conservative)

Override flow:
  built-in defaults → merge with kj.config.yml policies section → shallow copy → apply gates
```

**Why:** Not all tasks benefit from the same pipeline stages. Running TDD checks on infrastructure tasks (CI configs, Dockerfiles) or documentation tasks produces false positives and wastes time. Running SonarQube on pure documentation changes is meaningless. The policy-resolver lets the pipeline adapt its quality gates to the nature of the work, while defaulting to the most conservative profile (`sw`) when the task type is unknown — ensuring safety without sacrificing flexibility.

## Key Architectural Decisions

### CLI wrapping vs direct API calls

Karajan wraps existing AI agent CLIs (claude, codex, gemini, aider) rather than calling AI provider APIs directly.

**Advantages:**
- Uses your existing subscriptions — no separate API keys needed
- Predictable cost — you pay your plan rate, not per-token
- Agents handle their own context management, tool use, and safety features
- Upgrades automatically when you update the CLI

**Trade-offs:**
- Less granular control over prompts and parameters
- Cost tracking is estimated, not actual billing
- Rate limiting is detected by Karajan (v1.4+) with automatic fallback and session pause

### Markdown-based role instructions

Role instructions (what to do, how to review, what rules to enforce) are stored as `.md` files, not hardcoded.

**Advantages:**
- Users can override any role without touching code
- Three-level resolution: project → user → built-in
- Easy to version control and share
- Non-developers can modify review rules

### Session persistence on disk

All session state is written to disk as JSON files, not kept in memory.

**Advantages:**
- Survives crashes and restarts
- Enables pause/resume across sessions
- Enables post-run reporting and audit trails
- No database dependency

### Estimated budget tracking

Token usage is counted and costs are estimated using published pricing rates, rather than querying actual API billing.

**Advantages:**
- Works with CLI agents that don't expose billing data
- Provides relative cost comparison between approaches
- Enables budget guardrails (warn at 80%, stop at 100%)

**Trade-off:** Reported costs are approximate — useful for comparison and guardrails, not for invoicing.

## References

- [jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) — Hexagonal architecture patterns (ports & adapters) that influenced the agent adapter design
- [ADR-001: Role-Based AI Architecture](/docs/architecture/overview/) — Architecture decision record in the karajan-code repository
- [Model Context Protocol](https://modelcontextprotocol.io/) — The standard used for Karajan's MCP server integration
