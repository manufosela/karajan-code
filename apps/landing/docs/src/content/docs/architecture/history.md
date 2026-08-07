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
- 12 configurable roles: discover, triage, researcher, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter
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

## Phase 17: Pre-Execution Discovery (v1.16.0)

**What changed:** Added a new pre-pipeline discovery stage that analyzes task specifications for gaps, ambiguities, and missing information before any code is written. Five specialized discovery modes provide different validation lenses.

**Key additions:**
- `DiscoverRole` extending `BaseRole` — 12th configurable pipeline role
- 5 discovery modes: `gaps` (default gap detection), `momtest` (Mom Test validation questions), `wendel` (behavior change adoption checklist), `classify` (START/STOP/DIFFERENT classification), `jtbd` (Jobs-to-be-Done generation)
- `kj_discover` MCP tool for standalone gap detection outside the pipeline
- Pipeline integration: opt-in pre-triage stage via `--enable-discover` flag or `pipeline.discover.enabled` config
- Non-blocking execution: discovery failures log warnings and continue the pipeline gracefully
- Prompt builder with mode-specific sections and JSON schema enforcement
- Output parser with field validation, severity normalization, and filtering of incomplete entries

**Architecture addition:**
```
Before v1.16.0:
  kj_run → triage → researcher? → planner? → coder → ...

After v1.16.0:
  kj_run → discover? → triage → researcher? → planner? → coder → ...

  discover (gaps mode):
    task spec → identify gaps, ambiguities, assumptions → verdict: ready | needs_validation
    → gaps[]: { id, description, severity, suggestedQuestion }

  discover (momtest mode):
    task spec → gaps + Mom Test questions (past behavior, not hypotheticals)
    → momTestQuestions[]: { gapId, question, targetRole, rationale }

  discover (wendel mode):
    task spec → 5 behavior change conditions (CUE, REACTION, EVALUATION, ABILITY, TIMING)
    → wendelChecklist[]: { condition, status: pass|fail|unknown, justification }

  discover (classify mode):
    task spec → behavior change type (START, STOP, DIFFERENT, not_applicable)
    → classification: { type, adoptionRisk, frictionEstimate }

  discover (jtbd mode):
    task spec + context → reinforced Jobs-to-be-Done
    → jtbds[]: { id, functional, emotionalPersonal, emotionalSocial, behaviorChange, evidence }

Standalone:
  kj_discover(task, mode) → structured discovery output (no pipeline execution)
```

**Why:** AI-generated code is only as good as its input specification. When tasks are ambiguous or incomplete, the coder agent makes assumptions that may not match the stakeholder's intent — leading to rework cycles. The discovery stage catches these gaps before any code is written, when the cost of clarification is lowest. The five modes provide different validation lenses: `gaps` for technical completeness, `momtest` for stakeholder validation, `wendel` for adoption readiness, `classify` for change impact assessment, and `jtbd` for understanding the underlying user needs. Discovery is opt-in and non-blocking to avoid adding friction to well-defined tasks.

## Phase 18: Architectural Design & Code Quality (v1.17.0)

**What changed:** Added a pre-construction architecture design role and resolved all SonarQube issues across the codebase, reducing cognitive complexity from 345 to 15 in the main orchestrator.

**Key additions:**
- ArchitectRole: 13th configurable pipeline role that designs solution architecture (layers, patterns, data model, API contracts, tradeoffs) between researcher and planner
- Interactive architecture pause: pipeline pauses with targeted questions when the architect detects design ambiguity (`verdict: "needs_clarification"`)
- Auto ADR generation: architectural tradeoffs are automatically persisted as Architecture Decision Records in Planning Game
- Triage → architect activation: triage auto-activates architect based on task complexity, scope, and design ambiguity
- Planner architectContext: planner generates implementation steps aligned with architectural decisions
- SonarQube full cleanup: 205 issues → 0 (CRITICAL, MAJOR, MINOR)
- Cognitive complexity refactoring: orchestrator.js (345→15), display.js (134→2), server-handlers.js (101→3), config.js (55→10)
- Handler dispatch maps: replaced large switch/if-else chains with object dispatch patterns
- 1454 tests across 118 files

**Architecture addition:**
```
Before v1.17.0:
  kj_run → discover? → triage → researcher? → planner? → coder → ...

After v1.17.0:
  kj_run → discover? → triage → researcher? → architect? → planner? → coder → ...

  architect:
    task + researchContext + discoverResult → design architecture
    → verdict: "ready" → architectContext passed to planner
    → verdict: "needs_clarification" → askQuestion → human answers → re-evaluate
    → tradeoffs[] → auto-create ADRs in Planning Game (if PG card linked)

  Cognitive complexity before/after:
    orchestrator.js:  345 → 15 (extracted 24+ helper functions)
    display.js:       134 →  2 (EVENT_HANDLERS dispatch map)
    server-handlers:  101 →  3 (toolHandlers dispatch map)
    config.js:         55 → 10 (declarative flag maps)
```

**Why:** The pipeline had a gap between understanding (researcher) and planning (planner): nobody was making architectural decisions. The coder was forced to make design choices on the fly — layer boundaries, data models, API contracts, technology tradeoffs — without validation. This led to rework when decisions didn't match stakeholder expectations. The architect role fills this gap by producing explicit, reviewable design decisions before any code is written. The SonarQube cleanup was equally important: cognitive complexity had grown unchecked as the orchestrator evolved through 17 phases. The refactoring replaced monolithic functions with composable helpers and dispatch maps, making the codebase maintainable as it continues to grow.

## Phase 19: Deterministic Guards Layer (v1.18.0)

**What changed:** Added a regex/pattern-based validation layer that complements probabilistic LLM decisions with deterministic checks. Three guards now run at different pipeline stages.

**Key additions:**
- **Output guard**: scans git diffs for destructive operations (rm -rf, DROP TABLE, git push --force, disk format), exposed credentials (AWS keys, private keys, GitHub/npm tokens), and protected file modifications (.env, serviceAccountKey.json). Blocks pipeline on critical violations. Custom patterns and protected files configurable via `guards.output`.
- **Perf guard**: scans frontend file diffs (.html, .css, .jsx, .tsx, .astro, .vue, .svelte) for performance anti-patterns — images without dimensions/lazy loading, render-blocking scripts, missing font-display, document.write, heavy dependencies (moment, lodash, jquery). Advisory by default, configurable to block via `guards.perf.block_on_warning`.
- **Intent classifier**: keyword-based deterministic pre-triage. Classifies obvious task types (doc, add-tests, refactor, infra, trivial-fix) without LLM cost. Runs before discover/triage in pre-loop. Custom patterns with configurable confidence threshold via `guards.intent`.
- Guards config schema in `kj.config.yml` with custom patterns, protected files, and thresholds
- 1505 tests across 121 files

**Architecture addition:**
```
Before v1.18.0:
  kj_run → discover? → triage → researcher? → architect? → planner? → [coder → refactorer? → TDD → sonar → reviewer]

After v1.18.0:
  kj_run → intent? → discover? → triage → researcher? → architect? → planner? → [coder → refactorer? → guards → TDD → sonar → reviewer]

  guards layer:
    output-guard: diff → scan for destructive ops + credential leaks + protected files
    perf-guard:   diff → scan frontend files for performance anti-patterns
    intent-guard: task description → keyword classification → skip LLM triage for obvious types
```

**Why:** LLM-based validation (reviewer, triage) is powerful but probabilistic — it can miss obvious patterns or hallucinate false negatives. Deterministic guards provide a fast, zero-cost, 100% reliable first line of defense for well-defined anti-patterns. The output guard prevents catastrophic mistakes (deleting files, leaking credentials). The perf guard catches common frontend performance issues that LLMs often overlook (CLS from images without dimensions, render-blocking scripts). The intent classifier saves LLM calls for tasks that are obviously documentation, tests, or refactoring — reducing latency and cost. All three are configurable with custom patterns, making them extensible without code changes.

**Future: WebPerf Quality Gate** — The static perf guard is the first phase of a planned WebPerf quality gate. The second phase will integrate dynamic performance scanning using headless Chrome, inspired by [Joan León](https://joanleon.dev/)'s [WebPerf Snippets](https://webperf-snippets.nucliweb.net/) — a collection of performance measurement snippets for Core Web Vitals, resource loading, and runtime analysis. Joan is currently building a CLI tool for this; once available, it will be integrated as a post-loop performance scanner, complementing the static guard with real runtime metrics.

## Phase 20: Impeccable Design Auditor (v1.24.0)

**What changed:** Added an automated UI/UX quality gate that audits changed frontend files for design issues, and enhanced triage and intent classifier with frontend detection.

**Key additions:**
- **Impeccable role**: 14th configurable pipeline role — automated design auditor that checks changed frontend files for accessibility, performance, theming, responsive, and anti-pattern issues. Runs after SonarQube, before reviewer. Applies fixes automatically.
- Frontend detection in triage: triage now identifies frontend tasks and auto-activates the impeccable role when appropriate
- Frontend detection in intent classifier: deterministic keyword-based frontend classification without LLM cost
- `enableImpeccable` config/CLI/MCP flag for explicit activation
- `--enable-impeccable` CLI flag for `kj run`
- `enableImpeccable` MCP parameter for `kj_run`
- 1586 tests across 130 files

**Architecture addition:**
```
Before v1.24.0:
  [coder → refactorer? → guards → TDD → sonar? → reviewer]

After v1.24.0:
  [coder → refactorer? → guards → TDD → sonar? → impeccable? → reviewer]

  impeccable:
    changed frontend files → audit for a11y, perf, theming, responsive, anti-patterns
    → auto-fix issues → report remaining issues to reviewer
```

**Why:** SonarQube catches code quality issues but misses UI/UX design problems — wrong contrast ratios, missing aria attributes, non-responsive layouts, hardcoded colors instead of theme tokens, layout shifts from images without dimensions. The impeccable role fills this gap with a specialized design audit focused exclusively on frontend quality. It runs after SonarQube (which handles code quality) and before the reviewer (which handles logic and architecture), giving the reviewer a cleaner diff to focus on. Triage auto-activates it for frontend tasks so developers don't need to remember the flag.

## Phase 20.1: Session Overrides & Solomon Style-Only Blocks (v1.24.1)

**What changed:** Fixed two issues — session overrides lost on resume, and Solomon not detecting reviewer style-only blocks.

**Key fixes:**
- Session overrides (agent assignments, flags) are now preserved when resuming a session via `kj_resume`
- Solomon Rule 6: detects when a reviewer is blocking exclusively on style/formatting issues (not logic or correctness) and auto-escalates to human review instead of stalling the pipeline

**Why:** Session overrides set via `kj_preflight` were lost on resume, causing resumed sessions to revert to default config. Solomon's existing rules caught scope and overreach issues but missed a common stall pattern: reviewers blocking on style-only concerns (naming, formatting, comment style) that are subjective and unlikely to converge through automated iteration.

## Phase 21: Autonomous Orchestrator (v1.25.0)

**What changed:** Solomon becomes the Pipeline Boss that evaluates every reviewer rejection with smart iteration logic. The pipeline auto-detects TDD and auto-manages SonarQube, reducing configuration to near-zero for standard projects.

**Key additions:**
- **Solomon as Pipeline Boss**: evaluates every reviewer rejection, classifies issues as critical vs. style-only, can override style-only blocks. Smart iteration control decides whether to retry or proceed based on issue classification
- **Auto-detect TDD**: pipeline detects the project's test framework (Vitest, Jest, Mocha, etc.) and enables TDD methodology automatically — no `--methodology` flag needed
- **SonarQube auto-manage**: auto-starts Docker container, auto-generates `sonar-project.properties` if missing, treats coverage-only results as advisory (non-blocking)
- **Skip sonar/TDD for infra/doc tasks**: policy-resolver now skips SonarQube and TDD for infrastructure and documentation tasks automatically, reducing false positives
- 1605 tests across 130 files

**Architecture addition:**
```
Before v1.25.0:
  reviewer rejects → coder retries (same approach) → reviewer rejects again → stall

After v1.25.0:
  reviewer rejects → Solomon evaluates rejection
    → critical issues → coder retries with targeted feedback
    → style-only issues → Solomon overrides, pipeline continues
    → mixed issues → coder retries on critical only, style deferred

TDD auto-detect:
  project has vitest/jest/mocha → methodology = "tdd" (auto)
  project has no test runner → methodology = "standard" (auto)
  --methodology flag → always wins (explicit override)

SonarQube auto-manage:
  sonar enabled + Docker not running → auto-start container
  sonar enabled + no config file → auto-generate sonar-project.properties
  sonar result = coverage-only → advisory (non-blocking)
```

**Why:** The pipeline was becoming increasingly autonomous but still required manual configuration for TDD methodology and SonarQube setup. Solomon's evolution from supervisor to Pipeline Boss addresses a key bottleneck: reviewer rejections that stall the pipeline on style-only concerns while critical issues get lost in the noise. Auto-detecting TDD and auto-managing SonarQube removes the two most common configuration friction points, making the pipeline truly zero-config for standard projects.

### v1.25.1: Auto-Simplify Pipeline

Auto-simplify pipeline: triage level 1-2 (trivial/simple) runs a lightweight coder-only flow, skipping reviewer, tester, and other post-coder stages. Level 3+ (medium/complex) gets the full pipeline. Configurable via `--no-auto-simplify` CLI flag or `autoSimplify: false` MCP parameter.

### v1.25.2: Anti-Bypass Guardrail

**v1.25.2** — Anti-bypass guardrail for `kj_resume`: validates answers against prompt injection patterns, rejects too-long inputs, defense-in-depth truncation. 36 new tests.

### v1.25.3: Provider Outage Resilience

**v1.25.3** — Provider outage resilience: 500/502/503/504 and connection errors now trigger automatic standby and retry (same as rate limits). On resume after outage, the coder is explicitly informed it was an external provider failure, not a code or KJ problem.

## Phase 22: RTK Integration (v1.27.0)

**v1.27.0** — RTK integration: `kj doctor` detects RTK for 60-90% token savings, `kj init` recommends installation, README and docs updated with RTK as recommended companion tool.

**v1.27.1** — Fix MCP project directory resolution: all MCP tools now accept explicit `projectDir` parameter. Resolution order: explicit param > MCP roots > cwd validation > error with instructions (no silent fallback).

## Phase 23: Codebase Health Audit (v1.28.0)

**Phase 23: Codebase Health Audit (v1.28.0)** — New `kj audit` command for read-only codebase analysis. Analyzes 5 dimensions: security, code quality (SOLID/DRY/KISS/YAGNI), performance, architecture, and testing. Available as CLI, MCP tool (`kj_audit`), and skill (`/kj-audit`). Generates structured reports with A-F scores per dimension and prioritized recommendations.

## Phase 24: Codebase Quality Refactor (v1.29.0)

**v1.29.0** — Codebase quality refactor driven by self-audit findings: PipelineContext object replaces 15+ parameter destructuring, MCP handlers reduced by 151 lines via shared `runDirectRole()`, Planning Game logic extracted into event-driven adapter, 105 new agent unit tests, npm audit vulnerabilities patched.

## Phase 25: HU Reviewer (v1.30.0)

**v1.30.0** — New mandatory pipeline stage for user story certification. Scores 6 quality dimensions (0-10 each, threshold 40/60), detects 7 antipatterns, rewrites weak HUs, pauses for FDE context when needed. Supports dependency graphs with topological execution ordering. Local file storage with future adapter pattern.

## Phase 26: Mandatory Audit Post-Approval (v1.32.0)

**v1.32.0** — Mandatory audit post-approval: final quality gate runs after reviewer+tester+security pass. Checks generated code for critical/high issues — if found, loops coder back to fix. If clean, pipeline is CERTIFIED. Also: quiet mode by default (raw agent output suppressed), Solomon autonomous decisions (checkpoints auto-continue, tester/security advisory), CLI inline readline prompt, budget N/A when provider doesn't report usage.

## Phase 27: Product Context & Multi-Format AC (v1.33.0)

**v1.33.0** — Product context via `.karajan/context.md`: projects can define domain knowledge, glossary, and constraints that are injected into every pipeline role prompt. Multi-format acceptance criteria: supports Gherkin (Given/When/Then), Checklist, Pre/Post-conditions, and Invariants — auto-detected from task input. RTK auto-integration: when RTK is installed, Karajan auto-configures token optimization without manual setup. Architect containerization: architect role outputs are now isolated in structured containers for cleaner planner handoff.

## Phase 28: HU Board Dashboard (v1.34.0)

**v1.34.0** — HU Board: full-stack web dashboard for visualizing HU (user story) data and pipeline sessions across all projects. Kanban board with drag-and-drop, session timeline with quality score overlays, multi-project filtering. Docker-ready deployment with auto-sync from local `.karajan/` session and HU files. Standalone app that reads Karajan's local data and presents it in a browser-based UI.

### v1.34.1: Reliability Fixes

**v1.34.1** — 5 reliability fixes: auto-preflight for seamless pipeline start, robust JSON parser that handles malformed agent output, model compatibility layer for cross-provider model names, budget estimation with fallback for unknown models, and coder no-placeholder prompt that prevents agents from leaving TODO stubs.

### v1.34.2: HU Board CLI & MCP Integration

**v1.34.2** — HU Board integrated into CLI (`kj board start/stop/status/open`), MCP (`kj_board` tool for start/stop/status), init wizard (enable HU Board during `kj init`), auto-start option (board starts automatically on `kj run`), and skills mode support.

### v1.34.3: Cognitive Complexity Refactor

**v1.34.3** — Reduced cognitive complexity across 6 core files. Zero skipped tests, 44 new board backend tests.

### v1.34.4: Cross-Platform Install

**v1.34.4** — OS-aware install commands: macOS uses brew, Linux uses curl/apt/pipx. Agent install instructions adapt to the user's platform.

## Phase 29: Bootstrap Gate (v1.35.0)

**v1.35.0** — Mandatory bootstrap gate for all KJ tools: validates prerequisites (git repo, remote, config, agents, SonarQube) before any tool runs. Hard-fail with actionable fix instructions, never silently degrades. Removed default admin/admin SonarQube credentials (security fix).

### v1.36.0: Real Usage Metrics & kj-tail

**v1.36.0** — Extract real usage metrics from Claude and Codex CLIs. `kj doctor` validates agent config files (JSON, TOML, YAML). Resilient model fallback and Solomon conflict context. Stage name in agent heartbeat/stall messages.

**v1.36.1** — `kj-tail` as installable CLI command with `--help` and filtering. Three ways to use Karajan documented: CLI, MCP, kj-tail. Full pipeline example with booking API output. Executor info in all pipeline stage events (provider, AI/skill/local).

## Phase 30: Injection Guard (v1.37.0)

**v1.37.0** — Injection Guard: prompt injection scanner for AI-reviewed diffs and PRs. Scans diffs before passing them to AI reviewers, detecting directive overrides ("ignore previous instructions"), invisible Unicode characters (zero-width spaces, bidi overrides), and oversized comment block payloads. Runs as a deterministic guard in the pipeline (before reviewer stage) and as a standalone GitHub Action on every PR.

## Phase 31: Integrated HU Manager (v1.38.0)

**v1.38.0** — Integrated HU Manager: triage auto-activates hu-reviewer for medium/complex tasks, AI-driven decomposition into 2-5 formal HUs with dependencies, sub-pipeline execution per HU with state tracking (pending→coding→reviewing→done/failed/blocked), PG adapter feeds card data to hu-reviewer, history records for all pipeline runs. 49 new tests.

### v1.38.1: kj_hu Tool, Multi-Language TDD, Solomon Readable Messages

**v1.38.1** — New `kj_hu` MCP tool for managing user stories (create, update, list, get) directly from the HU Board. Multi-language TDD support: 12 languages beyond JS/TS (Java, Python, Go, Rust, C#, Ruby, PHP, Swift, Dart, Kotlin). Solomon readable messages for clearer pipeline decisions. Sonar token fix for secure credential handling. MCP sovereignty: tools reject external override attempts, preserving human-confirmed configuration. 2142 tests across 170 files.

### v1.38.2: Reviewer Visibility & Credential Hardening

**v1.38.2** — Reviewer now sees new files created by coder (git add -A before diff). All 15 credential patterns block the pipeline (secrets never pass). Coder template mandates .env usage for all keys.

**v1.39.0** — CLI update notification: non-blocking npm version check at startup, cached 24h.

## Phase 32: Pipeline Sovereignty & Observations (v1.40.0)

**v1.40.0** — Pipeline sovereignty: MCP input guard strips host AI overrides, preventing external agents from silently changing pipeline configuration. New `kj_suggest` MCP tool (22nd) allows observations to Solomon without interrupting the pipeline. E2E install tests across ubuntu, macOS, and Windows. CLI update notification at startup.

## Phase 33: OpenSkills Integration (v1.41.0)

**v1.41.0** — OpenSkills integration: new `kj_skills` MCP tool (23rd) for managing domain-specific skills. Skill injection in coder, reviewer, and architect prompts. Triage auto-detects and installs domain skills relevant to the current task.

## Phase 34: Lean Audit & Lazy HU Planning (v1.42.0)

**v1.42.0** — Lean audit measures basal cost: dead code detection, unused dependency analysis, and complexity growth tracking. Lazy HU planning: refine one HU at a time with context from completed ones, reducing upfront planning overhead.

## Phase 35: Docker & Shell Installer (v1.43.0)

**v1.43.0** — Docker image (Alpine + Node 20) for containerized execution. Shell installer (`curl | sh`) for one-line installation without npm.

## Phase 36: i18n (v1.44.0)

**v1.44.0** — i18n: kj init detects OS locale, asks for pipeline and HU language. Agents respond in the configured language. Supports English and Spanish.

## Phase 37: WebPerf Quality Gate (v1.45.0)

**v1.45.0** — WebPerf Quality Gate: Core Web Vitals (LCP, CLS, INP) as pipeline gate via Chrome DevTools MCP + Joan Leon's WebPerf Snippets skills. Configurable thresholds.

## Phase 38: Parallel HU Execution & Standalone Binaries (v1.46.0)

**v1.46.0** — Parallel HU execution via git worktrees (independent HUs run concurrently). SEA binary build scripts + GitHub Actions release workflow (standalone binaries without Node.js). Python wrapper for pip install. Docker image + shell installer.

## Phase 39: PG Card Lifecycle & HU Board Sync (v1.48.0)

**v1.48.0** — PG card lifecycle tracking: pipeline events now update Planning Game card status in real time throughout the full lifecycle (created, in-progress, blocked, to-validate, done). HU Board real-time status sync: board UI reflects card state changes as they happen, eliminating manual refresh.

## Phase 40: Async I/O & Centralized SonarQube (v1.49.0)

**v1.49.0** — Async I/O: all file and network operations converted to non-blocking async patterns. Centralized SonarQube configuration: single source of truth for Sonar settings across CLI, MCP, and pipeline. 61 catch blocks documented and audited for proper error handling.

## Phase 41: God-Module Split & Critical Unit Tests (v1.50.0)

**v1.50.0** — 71 new unit tests covering 3 critical modules. Split 3 god-modules into 12 focused sub-modules for better maintainability and testability. 2473 tests across ~190 files.

**v1.50.1** — Pipeline messages respect configured language (EN/ES message catalog). Checkpoint UI restructured with numbered options instead of ambiguous Accept/Decline buttons.

## Phase 42: RTK Real Integration (v1.51.0)

**v1.51.0** — RTK real integration: auto-install during kj init, enforce wrapping in internal Bash commands, measure and report token savings per session. Audit/analysis tasks skip coder/reviewer and route directly to security+audit roles. Homebrew tap (`brew tap manufosela/tap && brew install karajan-code`) added as an alternative installation method for macOS users.

## Phase 43: No-Code Pipeline Mode (v1.52.0)

**v1.52.0** — No-code pipeline mode: triage detects non-code tasks (SQL analysis, CSV transforms, data reports) and disables TDD/SonarQube/reviewer stages automatically. Three built-in no-code skills: `sql-analysis`, `csv-transform`, `data-report`. Tasks that don't produce code changes skip the entire quality gate loop.

## Phase 44: Plan-Run Connection & MCP Response Compressor (v1.53.0 - v1.53.1)

**v1.53.0** — Plan to Run connection: `kj_plan` now runs researcher + architect before planner, persisting the full result. `kj_run --plan` loads the persisted plan context and skips pre-loop stages (researcher, architect, planner), going straight into the coder loop with full architectural context already resolved.

**v1.53.1** — MCP response compressor: strips verbose fields from MCP tool responses, truncates large arrays, and outputs compact JSON. Reduces token consumption when MCP hosts relay pipeline results back to the conversation context.

## Phase 45: Design Refactoring Mode (v1.54.0)

**v1.54.0** — `--design` flag: impeccable role switches from audit-only to refactoring mode. Coder applies design changes (hierarchy, spacing, responsive, a11y, animations, theming).

## Phase 46: kj undo & Doc Links (v1.55.0)

**v1.55.0** — New `kj undo` command (24th MCP tool) reverts the last pipeline run with a soft git reset, or `--hard` to discard all changes. All error messages now include a direct URL to the relevant documentation page, making troubleshooting faster without manual doc searches.

## Phase 47: Status Dashboard & Auto-Detect Stack (v1.56.0)

**v1.56.0** — `kj status` terminal dashboard showing HU states, current pipeline stage, timing, and progress. MCP returns structured JSON for programmatic access. `kj init` now auto-detects the project stack by scanning package.json, go.mod, Cargo.toml, requirements.txt, and similar files. Detected frameworks auto-configure the pipeline (impeccable enabled for frontend projects, test framework pre-selected, SonarQube language settings applied). HU Board now supports optional Bearer token authentication via `HU_BOARD_TOKEN` environment variable.

## Phase 48: Telemetry & MCP Graceful Restart (v1.57.0)

**v1.57.0** — Opt-out telemetry: anonymous usage statistics (version, OS, command, pipeline duration, success rate) to help improve Karajan. No task descriptions, code, or personal data collected. Opt out with `telemetry: false` in config or `KJ_TELEMETRY=false` env var. MCP graceful restart: after npm update, the MCP server writes a restart marker and exits cleanly. The new instance detects the marker and starts with fresh code, replacing the abrupt `Transport closed` behavior. `kj_resume` now respects the session's saved config snapshot, preserving flags like `--no-sonar` that were set during the original run.

## Phase 49: SEA Binaries, Model Resolution, SonarQube Robustness (v1.57.1 - v1.57.2)

**v1.57.1** — SEA (Single Executable Application) binary build: standalone binary via `node scripts/build-sea.mjs` that requires no Node.js installation. GitHub Actions release workflow builds binaries for linux-x64, darwin-arm64, and win-x64 with SHA256 checksums on every tag. YAML config loader now tolerates duplicated keys in user config files.

**v1.57.2** — Model/provider resolution: when the model field uses a prefixed format like `gemini/pro`, KJ infers the provider from the prefix and strips it (model becomes `pro`). Incompatible explicit models (e.g., a gemini model on a claude provider) are dropped gracefully. SonarQube auto-start wait: after `docker compose up`, waits up to 60 seconds (polling every 5s) for SonarQube to become ready, fixing false "auto-start failed" errors on cold boot. Subprocess stdin prevention: all subprocesses run with `stdin: "ignore"`, preventing indefinite hangs when SonarQube, agents, or npm prompt for input. `kj init` gitignore entries: auto-appends `.kj/`, `.agent/`, `.scannerwork/` to the project `.gitignore` if missing. Global repo protection scripts: `protect-all-repos.sh` (branch protection), `install-guard-all-repos.sh` (AI attribution guard), `ai-attribution-guard.yml` (standalone workflow).

## Phase 46: Domain Knowledge System (v1.58.0)

**v1.58.0** — New `domain-curator` role (16th role). Discovers, proposes and synthesizes business-domain knowledge so all downstream roles work with real-world context — not just technical frameworks.

**Key additions:**
- Domain storage: `~/.karajan/domains/` (user/company bank, reusable across projects) + `.karajan/domains/` (project-specific overrides). DOMAIN.md files with YAML frontmatter and markdown sections
- Domain registry: local JSON index at `~/.karajan/domain-registry.json` with search by tags/hints
- Domain synthesizer: filters relevant sections by keyword overlap, compacts to token budget
- Domain Curator role: deterministic (no LLM cost) — loads domains, proposes selection to user (if interactive), synthesizes context
- Enhanced `buildAskQuestion`: detects `server.getClientCapabilities()?.elicitation` to adapt to host MCP capabilities. Supports structured question types (multi-select, select, confirm) with free-text response parser
- Triage `domainHints`: triage detects business-domain keywords and passes them to the Curator
- Skill-loader type discrimination: `SKILL.md` files with `type: domain` frontmatter are loaded by the Curator (injected into all roles) vs `type: technical` (coder-only)
- `domainContext` injected into all downstream role prompts (Researcher, Architect, Planner, Coder, Reviewer, HU-Reviewer)
- 102 new tests

**v1.58.1** — CLI welcome screen on bare `kj` invocation: shows version, configured agents, and quick start commands.

**Architecture addition:**
```
triage → domainHints: ["dental", "clinical"]
       → domain-curator → loadDomains + registry.search → askQuestion (if interactive) → synthesizeDomainContext
       → domainContext injected into researcher, architect, planner, coder, reviewer, hu-reviewer prompts
```

**Why:** AI agents writing code for a specific industry (dental, logistics, finance) make better decisions when they understand the business domain — correct naming, real edge cases, proper validation rules. The Domain Curator adds this context at zero LLM cost (deterministic loader + synthesizer), reusable across projects.

## Phase 50: Karajan Brain + Solomon Judge (v2.0.0)

**v2.0.0** — Major architectural redesign. Introduces **Karajan Brain** as the central AI orchestrator and refines **Solomon** from pipeline boss to AI judge consulted only on genuine dilemmas.

**Key additions:**
- `KarajanBrainRole` — central AI-powered orchestrator that routes all role-to-role communication
- `brain-coordinator.js` — integrates 5 Brain modules (queue, enrichment, verification, actions, compression)
- `feedback-queue.js` — typed message queue replacing the flat `last_reviewer_feedback` string
- `feedback-enrichment.js` — transforms vague feedback into actionable plans with file hints and severity
- `verification-gate.js` — detects 0-change coder iterations via `git diff --numstat` + untracked files
- `direct-actions.js` — allow-listed commands Brain can execute (npm install, gitignore updates, create_file, git_add)
- `role-output-compressor.js` — per-role compression strategies yielding 40-70% token savings between roles
- Smart init — assigns AI agents to roles by capability (claude=5, codex=4, gemini=3, aider/opencode=2), diversifies reviewer from coder
- Solomon refined to 4 advisory skills: security-vs-deadline, conflicting-quality-gates, stalled-loop-analysis, risk-evaluation
- Deterministic security bypass: when reviewer has security-category issues, Brain skips Solomon and sends directly to coder

**Architecture:**
```
triage → Brain (routes) → researcher/architect/planner → Brain (compresses) → coder
                                                                               ↓
                                                    Brain (verifies changes) ←─┘
                                                                               ↓
                                            reviewer → Brain (enriches feedback)
                                                                               ↓
                                   security issue? → coder (Solomon bypassed) ─┤
                                   dilemma? → Solomon (opinion) → Brain decides┤
                                                                               ↓
                                    tester + security + impeccable (blocking)
                                                                               ↓
                                                                       audit → PR
```

**Removed:**
- v1 string-based `last_reviewer_feedback` flow
- Solomon as pipeline boss / blocking arbiter
- Per-role boilerplate (~200 LOC × 10 roles via `AgentRole` base class)
- Dead config paths and unused proxy layer

**Why:** v1 accumulated ad-hoc communication paths between roles (string feedback, solomon-as-boss, mixed concerns). v2 centralizes orchestration intelligence in Brain, keeps Solomon as a focused AI judge for true dilemmas, and yields 40-70% token savings through per-role compression. Full upgrade guide in [MIGRATION-v2.md](https://github.com/manufosela/karajan-code/blob/main/MIGRATION-v2.md).

## Phase 50.1: Brain wired into the pipeline (v2.0.1)

**v2.0.1** — Patch release that actually turns Brain on. v2.0.0 shipped the Brain modules but nothing imported them, so the pipeline still ran v1 logic (Solomon-as-boss). This release wires Brain into the real execution path.

**Fixed:**
- `brainCtx` is now created at session init and threaded through coder and reviewer stages
- **Coder stage**: uses Brain's enriched feedback prompt from the typed queue; calls `verifyCoderRan` after each run; pipeline stalls after N consecutive 0-change iterations
- **Reviewer stage**: on correctness/tests/security rejections Brain bypasses Solomon and pushes typed issues to the feedback queue for the next iteration. Solomon is only consulted on style-only dilemmas.
- **Brain owns human escalation** — `solomon-rules` no longer prompts the user directly. Critical rule alerts (stale iterations, new deps) flow through Brain → Solomon AI judge → human (only if neither can resolve the dilemma).
- **Brain actively consults Solomon** on detected dilemmas and applies Solomon's decision (approve / continue / pause).
- **Stale detection** — reviewer checkpoints now record a feedback signature, coder checkpoints record `filesChanged`. Previously both were empty/zero, making solomon-rules falsely detect "stale" after 3 iterations with different bugs.
- **HU Board auto-start crash** on nvm/macOS (reported by Jorge del Casar). `spawn('node', ...)` failed with ENOENT because the detached subprocess didn't inherit node's PATH. Fixed by using `process.execPath` and adding an error handler so the pipeline never crashes from HU Board startup failures.

**Changed:**
- **Brain enabled by default** (`brain.enabled: true`). v2 is Brain architecture; users who explicitly don't want Brain can set `brain.enabled: false`, but the canonical v2 experience is Brain-on.

## Phase 50.2: Brain coverage + UX overhaul (v2.0.2)

**v2.0.2** — Extends Brain's coverage across all stages and makes `kj run` actually tell you what it's doing.

**Added:**
- **Brain compression + feedback queue across all stages**: researcher, architect, planner outputs are compressed for metrics; tester and security failures enter the typed feedback queue with enrichment for the next coder iteration.
- **Brain owns max_iterations decision**: at max_iterations Brain inspects its feedback queue — security entries → pause for human (cannot finalize with unresolved security issues), correctness/tests → extend iterations, empty queue → finalize, style-only → consult Solomon as advisor. Solomon is never invoked directly from max_iterations anymore.
- **Agent action lines in quiet mode**: `kj run` now interprets Claude's stream-json tool_use blocks into concise action lines (`Read packages/server/index.js`, `Bash $ npm install express`) so users see what the coder is doing without verbose mode.
- **Heartbeat visible in quiet mode**: `agent:heartbeat` events (every 30s) are no longer suppressed — `kj run` shows `⏳ claude working — 45s elapsed` instead of looking hung during long agent calls.
- **ASCII banner printed on `kj run`** regardless of TTY detection.

**Changed:**
- Rule alerts renamed from `solomon:alert` to `brain:rules-alert` (display: "⚠️ Rules alert" instead of "⚖️ Solomon alert"). The rules engine emits telemetry; it is not an invocation of Solomon.
- All stage `onOutput` handlers route through the unified `emitAgentOutput` helper: `kind=tool` → `agent:action` (visible in quiet mode), others → `agent:output` (verbose only).

## Phase 51: Auto-HU Decomposition (v2.1.0)

**v2.1.0** — Closes the fundamental architectural gap where complex tasks ran as one giant pipeline instead of splitting into atomic stories. From v2.1, when triage recommends decomposition, Karajan auto-generates a certified HU batch and runs each HU as an independent sub-pipeline with its own git branch, commit, and optional PR.

**Added:**
- **HU auto-generator** (`src/hu/auto-generator.js`) — converts triage subtasks into a certified HU batch with automatic setup HU when the project is new or has stack hints. Each HU classified into `task_type` (infra/sw/add-tests/doc/refactor/nocode) so downstream policy gates apply correctly per HU.
- **Triage → auto-gen → sub-pipeline wiring**: after triage + researcher + architect + planner, if triage flagged `shouldDecompose` and no manual `--hu-file` was passed, the batch is persisted to `.karajan/hu/auto-<sid>/batch.json` and injected as `stageResults.huReviewer`. The existing `needsSubPipeline` / `runHuSubPipeline` infrastructure picks it up.
- **Per-HU max_iterations** (`config.hu_max_iterations`, default 3) — each HU gets a focused iteration budget and a fresh Brain state (feedback queue, verification tracker, extension count reset to 0) so issues from one HU never bleed into the next.
- **Per-HU git automation** (`src/git/hu-automation.js`) — each HU gets its own branch (`feat/HU-<id>-<slug>`) chained from its parent HU's branch. On approval: commits atomically with `feat(HU-<id>): <title>`, optionally pushes and opens a PR (gated by existing `git.auto_commit`/`auto_push`/`auto_pr` flags).

**Why:** v2.0.x had a known gap — complex tasks triggered decomposition in triage but the pipeline ignored it and ran one giant coder invocation that produced 50-file blobs reviewers and testers couldn't validate properly. v2.1 closes this: big tasks become atomic branches/PRs, each with focused iteration budget, fresh Brain state, and isolated failure semantics. Reviewer, tester, and security can finally do their jobs.

## Phase 52: HU Board UX + Minimal HU scope (v2.2.0 - v2.2.1)

**v2.2.0** — HU Board UX overhaul: human-readable project names derived from task prompt, DELETE endpoints + per-card delete button, port fallback (4000→4009), auto-start on auto-HU generation with highlighted cyan URL banner. Also excludes `.kj/` worktrees from vitest.

**v2.2.1** — Critical fix: auto-generated HUs were too large because the setup HU embedded the full task description. Now setup HU says "DO NOT implement any business logic — ONLY project scaffolding" and task HUs target "<200 lines changed (like an atomic PR)". Legacy batch names derived from embedded "Part of:" text. Extended stopwords. Delete button moved to per-card.

## Phase 53: Complete Brain audit (v2.3.0)

**v2.3.0** — Exhaustive audit of the orchestrator found and fixed 21 v1 legacy violations where Solomon was invoked directly (bypassing Brain), `session.task` leaked into per-HU context, or feedback mutations skipped Brain's queue. Every stage now gates Solomon through Brain when enabled. Per-HU reviewer evaluates the HU scope, not the full spec. HU Board gains `/api/sync` endpoint for live batch detection. Model registry updated with 2026 families (Jorge del Casar #412).

## Phase 54: Executable Acceptance Tests (v2.4.0)

**v2.4.0** — First version where the full demo completes successfully end-to-end with auto-HU decomposition. Each HU now carries `acceptance_tests`: an array of shell commands that Brain executes after every coder iteration. All pass → HU approved. Any fail → Brain reads the exact error output and sends a concrete diagnostic to the coder ("install @vitest/coverage-v8", not "Coverage: not measured"). No reviewer. No generic tester. Concrete pass/fail. When `acceptance_tests` are defined, Brain replaces the standard reviewer/tester pipeline with a custom loop (coder → acceptance_tests → diagnose → retry). Security audit also included: `execSync` → `execFileSync` for git add, exact token allowlist matching, credentials file `0o600` permissions, token masking in MCP responses, vitest updated to 0 npm vulnerabilities. Demo result: 6 HUs, 280 tests, 97% coverage, 0 vulnerabilities.

## Phase 55: Mini Planning Game (v2.5.0)

**v2.5.0** — First-class two-phase workflow: plan first, then execute. `kj plan "task"` generates a v2 plan with HUs (globally unique IDs, acceptance tests, task_type classification). `kj plan list/show/validate/delete/ready/add-hu/remove-hu` give full CRUD over stored plans under `~/.kj/plans/`. `kj run --plan <planId>` executes the plan's HUs via the sub-pipeline with acceptance tests, updating the plan file in real time (status: running → done/failed). HU Board syncs from `~/.kj/plans/` — plans show up as projects with HU status. v2 schema with lazy v1→v2 migration, cycle detection in the dependency graph. Bug fixes in the same release: Sonar quality gate finally runs for `sw` HUs (acceptance_tests bypassed the standard pipeline), HU Board shows rich data (title, scope, acceptance criteria), vitest updated to 0 npm vulnerabilities.

## Phase 56: Modular Orchestrator + Infrastructure DI + Valibot (v2.6.0 / v2.6.1)

**v2.6.1** (patch, 2026-04-20) — Fixes the HU Board sync so sessions without a matching auto-batch no longer disappear: `syncSessionFile` now falls back `auto-<sessionId>` → `data.project_id` → `"default"` (Orphan sessions bucket) and always creates the project row. Also isolates the test suite from the developer's real `~/.kj/plans/` via a new `KJ_PLANS_DIR` knob. Restores two regressed tests.

**v2.6.0** — The biggest internal cleanup since Brain. `src/orchestrator.js` shrinks from a 2 084-line god-module to a 22-line public barrel over `src/orchestrator/flow-runner.js`; a new `StageExecutor` contract (`canRun` / `execute` / `onFailure`) with `StageRegistry` and `runStage()` makes future stages self-describing so the core no longer branches on `pipelineFlags` for every feature. Infrastructure DI lands under `src/infrastructure/`: `FileSystemService`, `CommandRunner`, and an `Environment` bundle let every agent (Claude, Codex, Gemini, Aider, OpenCode) route shell calls through a runner the tests can mock with `MockCommandRunner` instead of spawning real subprocesses. Config is now validated on load with Valibot — `review_mode` typos, `max_iterations: 0`, out-of-range `hu_board.port`, invalid `budget.warn_threshold_pct`, and negative `max_budget_usd` fail fast with readable messages; falsy CLI overrides (`--no-rebase`, `--reviewer-retries 0`) finally work as advertised (co-authored with Jorge del Casar from the revived PR #379). The session journal gains three new artifacts (`decisions.md`, `iterations.md`, `summary.md`) plus a directory-grouped `tree.txt`. Budget display now projects "With KJ vs Without KJ" savings from RTK + Brain compression. Test suite lands at 3 638 tests across 283 files, with 21 opt-in subsystem files labelled `[opt-in: <feature>]` and a new `tests/support/opt-in.js` helper driving `KJ_SKIP_OPTIN_*` env kill switches. HU Board auto-start gate is simplified to `hu_board.auto_start` alone and displays the URL in a prominent cyan banner at pipeline init. Central JSDoc typedef registry lands under `src/types/` with an opt-in `npm run typecheck`.

## Phase 57: addyosmani/agent-skills as first-source process catalog (v2.7.0 / v2.7.1 / v2.7.2 / v2.7.3)

**v2.7.3** (patch, 2026-04-23) — Three dogfooding fixes driven by a live test run. (1) Every task-taking command — CLI `kj run/code/review/plan/audit/discover/triage/researcher/architect` and the matching MCP tools — now accepts a task from a `.md` file via `--task-file <path>` (CLI) or `taskFile` (MCP). Positional `task` still wins when both are given. (2) CLI invocations finally write `.kj/run.log` like MCP does via a new `withCliRunLog()` helper, so `kj-tail` is symmetric regardless of whether Claude Code launches `kj` via Bash or via the MCP tool. (3) Node 18 LTS is supported for real now: preflight used to require Node 20 with a misleading message, but the four features it cited (`structuredClone`, `findLast`, `AbortSignal.timeout`, stable `fetch`) are all 18+; `MIN_NODE_MAJOR` lowered to 18, CI lint matrix gains `18.x`. `kj-tail` v1.38.0 additionally waits for the log file to appear instead of exiting when it is missing, so users can no longer miss early lines by racing the command.

**v2.7.2** (patch, 2026-04-23) — Skills observability: `summary.md` now includes a "Skills Used" section listing the addyosmani action (`cloned`/`pulled`/`fresh`/`unavailable`) and the role/task-resolved slugs injected into role prompts, the OpenSkills actually installed, and would-have-used recommendations when the CLI is missing. `kj-tail` v1.37.0 adds a 🎯 filter for `[skills:*]` events — magenta on success, yellow on graceful-degradation paths. Closes the loop started in v2.7.0: skill decisions are now visible in the live tail, in `.kj/run.log`, and in the persistent `summary.md`.

**v2.7.1** (patch, 2026-04-23) — Restores SEA platform binary publishing (`kj-linux-x64`, `kj-darwin-arm64`, `kj-win-x64.exe` + SHA256 checksums) on GitHub Releases. The `release-binaries.yml` workflow had been silently failing on every tag push since **v2.4.1** (5 consecutive releases shipped with empty assets). Root cause: `scripts/build-sea.mjs` does `await import("esbuild")` — an ESM dynamic import that resolves from local `node_modules` — while the workflow installed esbuild with `npm install -g`. Fix: `esbuild` (`^0.28.0`) and `postject` (`^1.0.0-alpha.6`) are now `devDependencies`, so a single `npm ci` pulls them into `node_modules` where the dynamic import resolves. v2.7.1 is byte-equivalent to v2.7.0 at runtime; the only difference is the release assets.

**v2.7.0** (2026-04-22) — Karajan now consults Addy Osmani's [`agent-skills`](https://github.com/addyosmani/agent-skills) curated process catalog **before** OpenSkills when resolving which skills to inject into role prompts. The two providers cover orthogonal axes: addyosmani brings lifecycle/process workflows (TDD, code-review, security-and-hardening, performance-optimization, git-workflow-and-versioning, CI/CD, debugging, docs, spec-driven, planning...) mapped per Karajan role, while OpenSkills keeps providing stack-specific skills (astro, react, prisma, vitest-patterns...). On first use, the catalog is shallow-cloned into `~/.karajan/agent-skills/`; subsequent runs refresh via `git pull` after `skills.addyosmani.refreshDays` (default 7 days). When git is absent or the network is unreachable, the step degrades silently and the pipeline continues unblocked. The role → slug map lives in `src/skills/addyosmani-role-map.js` (tester → `test-driven-development` + `browser-testing-with-devtools`, reviewer → `code-review-and-quality` + `code-simplification`, security → `security-and-hardening`, architect → `spec-driven-development` + `api-and-interface-design` + `planning-and-task-breakdown`, and so on). Task-text triggers add slugs on top — a task mentioning "performance" or "Core Web Vitals" pulls `performance-optimization`. New config surface: `skills.sources` (default `["addyosmani", "openskills", "local"]`) and `skills.addyosmani.{enabled,refreshDays,repoUrl}` validated by the Valibot schema. New CLI: `kj skills sync-addyosmani` forces a pull, `kj skills list-addyosmani` enumerates cached slugs with descriptions. 35 new test cases land in `tests/skills/addyosmani-*.test.js` covering frontmatter parsing, clone/pull lifecycle, TTL, path-traversal guards and graceful degradation. Test suite now at 3 672 tests across 285 files.

## Phase 58: Contract fixes — Sonar intrinsic + no fake API keys (v2.7.4)

**v2.7.4** (patch, 2026-04-24) — Three contract-level fixes revealed while the user dogfooded v2.7.3. (1) **Sonar is now intrinsic to Karajan for code tasks**, like TDD. The `sonarqube.enabled` config field and the `--no-sonar` CLI flag are IGNORED (deprecation warning at run start) — a code task without a quality gate is not a job Karajan can call complete. Sonar runs for `sw`/`refactor`/`add-tests` by policy and skips for `audit`/`doc`/`infra`/`analysis`/`no-code`. Solomon may still skip an iteration via runtime rule alerts (legitimate override based on evidence). (2) **Preflight no longer demands API keys Karajan doesn't use**. The v2.7.3 preflight FAILed with `ANTHROPIC_API_KEY not set` — blocking every Claude Code MCP run where the parent uses OAuth — even though Karajan never calls provider APIs directly (zero SDK imports, all agents spawn CLIs as subprocesses). Replaced with a real CLI availability check (`claude`/`codex`/`gemini` on PATH). (3) **Orchestrator no longer crashes** with `Cannot read properties of undefined (reading 'push')` on the Solomon init-error path — `addCheckpoint` now defensively initialises `session.checkpoints = []`. Two new architectural invariants (`tests/architecture/no-provider-apis.test.js` and `tests/architecture/sonar-intrinsic.test.js`) make these contracts enforceable in CI. New `docs/TESTS.md` test-suite guide (~280 lines) covers directory map, pipeline-coverage diagram, per-file explanation and contribution checklist.

## Phase 59: Audit-driven hardening (v2.8.0)

**v2.8.0** (minor, 2026-04-30) — The 2026-04-30 self-audit (`kj audit`) flagged 13 issues across security, code quality, performance, architecture, and testing. This release closes all of them in 16 PRs (#555 → #570) with 0 user-visible API changes. **Security** (PRs #555 + #562): every `child_process` call in `src/` migrated from template-string `execSync`/`execaCommand` to tokenised `execFileSync`/`execa` arg arrays — no shell metacharacter expansion anywhere, even with constant inputs. Seven sites closed across `verification-gate`, `derive-project-name-from-cwd`, `direct-actions`, `solomon-rules`, `cli`, `config-init`, `init-context`. **Tests** (PR #570): finished the FASE 1 e2e suite — 7 scenarios + `fake-coder.js` / `fake-sonar-server.js` infrastructure cover the 5-bug class from the 2026-04-27 demo regression (zombie-HU, saveSession-missing, Repairer unfixable, zombi-status, audit smoke). Each test < 90s; full e2e in 6s, no real LLM/network. **File splits** (PRs #560/#567/#568/#569): `cli.js` 699→113 LOC (+ 6 register modules), `commands/plan.js` 549→14 LOC shim (+ one file per sub-command), `iteration-loop.js` 513→311 LOC (+ 5 phase files), `pre-loop.js` 626→435 LOC. Every big driver under the 600-LOC ceiling. **ESLint hardening** (PRs #556/#557/#559/#564): baseline extended to `tests/` with the same bug-killer trio (`no-undef`, `import-x/no-unresolved`, `import-x/named`); `globalThis.__KJ_*` banned outside `src/config/test-harness.js`; `no-console: error` outside CLI/display paths; 57 warnings closed in `src/`, then `no-unused-vars` / `no-useless-assignment` / `no-useless-escape` / `preserve-caught-error` ratcheted warn→error. **Architecture & perf** (PRs #558/#565/#566): Node subpath imports map (`#utils/*`, `#session/*`, `#hu/*`, `#skills/*`) eliminates `../../../` chains; `adr-loader.js` and `garbage-collector.js` parallelised via `Promise.all`; per-directory coverage thresholds in `vitest.config.js`. **BREAKING (runtime floor)**: `engines.node` 18→20.10.0 (Node 18 LTS hit EOL on 2025-04-30; CI matrix dropped Node 18). 4 199 tests across 357 files.

## Phase 60: Audit overhaul — stack-aware, two-phase, deterministic-first (v2.9.0)

**v2.9.0** (minor, 2026-05-04) — `kj audit` becomes a stack-aware analysis tool with three deterministic security collectors, dimension auto-activation per project type, persistable reports, token/cost transparency, and an interactive prompt that lets the user inspect cheap findings before paying for the LLM phase. 13 audit PRs (`KJC-TSK-0354` → `KJC-TSK-0366`, #585-#600) plus the 5-PR dead-exports cleanup. Zero breaking changes for MCP/pipeline callers — the legacy `AuditRole.execute()` chains both phases identically.

**Two-phase mode** (`KJC-TSK-0364`, #597): the deterministic collectors (basalCost, Sonar findings, OSV-Scanner, Semgrep, WebPerf, stack detection) run in parallel and print a `## Deterministic Findings` section BEFORE prompting `Continue with LLM analysis? [y/N]`. New `--deterministic-only` flag for zero-token runs (3-second audits with concrete findings), `-y`/`--yes` to auto-confirm, `--json` bypasses the prompt to keep stdout pipeable. CI / non-TTY paths auto-confirm — zero behaviour change for pipelines.

**Three new deterministic security collectors**: SonarQube findings as ground truth in the prompt with rule IDs and line precision (`KJC-TSK-0361`, #588), OSV-Scanner integration covers CVEs across the entire OSV.dev DB (`KJC-TSK-0365`, #598) — broader than `npm audit`, no account, no upload — and Semgrep SAST catches XSS, SQLi, taint flow, hardcoded secrets, language-specific anti-patterns (`KJC-TSK-0366`, #600) — equivalent to `snyk code` but free for OSS. All three are best-effort: missing binary or unreachable host silently skips the section.

**Stack-aware prompt** (`KJC-TSK-0358`, #586): `detectProjectStack` feeds the LLM auditor what kind of project it's looking at — frontend-only, backend-only, fullstack, language, frameworks. Heuristics get filtered: no more N+1 query nags on Astro projects, no more bundle-size nags on Express APIs. New `accessibility` dimension (`KJC-TSK-0359`, #593) auto-activates for frontend / fullstack / unknown stack with WCAG 2.x checks (alt text, labels, ARIA, focus management, contrast hints in CSS tokens). New WebPerf section (`KJC-TSK-0360`, #594) with 10 frontend-perf patterns when no live CWV measurement is available, plus optional Core Web Vitals verdict integration via `config.webperf.lastResult`.

**Persistable reports + token transparency**: `--report-file <path>` (`KJC-TSK-0362`, #592) writes the audit to `.md` (with reproducibility header: timestamp, project, branch, commit, invocation flags) or `.json`. `$KJ_AUDIT_REPORT_DIR` env var as default directory for CI. Every audit ends with a `## LLM Usage` section (`KJC-TSK-0363`, #595) showing provider + model + duration + tokens (in/out/total) + estimated cost in USD. Visible in stdout, JSON output, and persisted reports.

**CLI/MCP parity bug fixed** (`KJC-TSK-0357`, #585): pre-patch the CLI `kj audit` re-implemented `createAgent + buildAuditPrompt + parseAuditOutput` inline, silently dropping the deterministic `basalCost`/`growthDelta` inputs that `AuditRole.execute()` collects when invoked via MCP. Both paths now drive the same `AuditRole` flow — same code path means same prompt content.

**Repo health**: 228 dead exports cleaned in 5 atomic bisect-friendly PRs (`KJC-TSK-0354` A-E, #579-#583). The `kj audit` `findDeadExports` detector itself was overcounting 55x vs knip ground truth — fixed in `KJC-TSK-0356` (#584): now understands `@internal` JSDoc, `await import("path")`, `import * as ns`, re-exports, and strips quoted strings before export-detection regexes. Result: 166 → 4 false positives (99.7% noise reduction).

Full suite **4 305 tests across 367 files** — 106 new tests added for the audit overhaul.

## Phase 61: Agent-readiness — full agent-readability surface + score (v2.10.0)

**v2.10.0** (minor, 2026-05-05) — Karajan becomes the first orchestrator with a full agent-readability surface: an `llms.txt` index at the root, a `SKILL.md` per CLI command under `docs/agents/`, and a static auditor (`kj audit --agent-readiness`) that scores any third-party repo against the same shape. Five PRs (#605–#610) bundling KJC-TSK-0151 / 0228 / 0349 / 0350 / 0351 / 0355. Karajan-on-Karajan agent-readiness score: 100/100. Zero breaking changes; every new flag is opt-in.

**`kj audit --agent-readiness`** (`KJC-TSK-0350`, #609): static, LLM-free score 0–100 across seven checks — llms.txt presence, llms.txt validity (sections + links), robots.txt AI-bot allowlist, per-doc token budget (≤ 32 KB), heading hierarchy, agents/README.md entry point, SKILL.md coverage. Output: per-check ✓/✗, weight-ranked top-fixes list. `--json` for CI; pure data transformation (no network, no LLM, no side effects). Two detector bug fixes brought Karajan-on-Karajan from 80 → 100/100: bash comments inside fenced code blocks no longer count as H1, and `<h1 align="center">` HTML banners are now recognised as valid H1s.

**SKILL.md per CLI subcommand** (`KJC-TSK-0349`, #608): six new `docs/agents/SKILL.kj-{doctor,init,board,review,resume,clean}.md` files closing the gap with `llms.txt` (which advertised them but only three existed). Each follows the established contract (What it does · Inputs · Outputs · Constraints · Side effects · Common failure modes · Example · Related). Architectural test `tests/architecture/agent-readability.test.js` fails CI when a SKILL link in `llms.txt` no longer resolves or a SKILL.md drops a required section. Plus `docs/demos/` (`KJC-TSK-0228`, #610) with three asciinema recording scripts (happy-path, agent-readiness, audit-with-llm), terminal config, pre-recording checklist, and `<asciinema-player>` embedding instructions — scripts as source of truth, .cast files re-recorded per release.

**Webperf quality gate inside the iteration loop** (`KJC-TSK-0151`, #605): `PerfStage` wires `PerfRole` (#603) into `runQualityGateStages` after Impeccable when `pipeline.perf.enabled` is true. PASS verdict → iteration continues; FAIL verdict → `setReviewerFeedback` with concrete blocking metrics + top opportunities, iteration retries; scanner unavailable (lighthouse missing/timeout) → log warn and skip — best-effort, never blocks the pipeline by itself. CLI/MCP parity: `--enable-perf` flag + matching `enablePerf` in `mcp/tools.js`, `mcp/run-kj.js`, sovereignty-guard allowlist, and `applySessionOverrides`.

**HU Board hardening** (`KJC-TSK-0355`, #607): binds `127.0.0.1` by default (was: all interfaces — fine on a personal laptop, problematic on shared coffee-shop WiFi). New `kj board start --bind <host>` for the explicit \"expose on LAN\" case; banner emits a warning + token URL when binding non-loopback. Token auto-generated at `~/.karajan/hu-board/token` (mode 0600, 32 random bytes hex, idempotent). Auth middleware only enforces the token for non-loopback peers — same-machine browser keeps working without `?token=` on every link. Three accepted carriers: `Authorization: Bearer`, `?token=`, `kj_board_token` cookie. `helmet` middleware sets X-Content-Type-Options, X-Frame-Options, conservative CSP, removes `X-Powered-By: Express`. `express-rate-limit` on `/api`: 300 req/min per IP, draft-7 `RateLimit-*` headers.

**a11y/WCAG/ARIA skills auto-route** (`KJC-TSK-0351`, #606): tasks mentioning accessibility / a11y / WCAG / ARIA / screen reader / keyboard navigation auto-pull the `frontend-ui-engineering` skill — until the upstream addyosmani catalog ships a dedicated a11y skill, that's the closest authoritative source for WCAG-aware UI work.

Full suite **4 358 tests across 373 files** — 53 new tests added for this cycle.

## Phase 61.1: Patch — `--json` stdout contamination fix (v2.10.1)

**v2.10.1** (patch, 2026-05-06) — One-line guard in `src/commands/audit.js` that suppresses the `[info]` banner when `--json` is set. Pre-fix, `kj audit --agent-readiness --json | jq` died with a parse error because the logger emitted `Auditing agent-readiness of <path>` to stdout BEFORE the JSON document. Detected in a pre-talk code review (3 Sonnet agents in parallel) before the 2026-05-21 demo. PR #613 (fix) + #614 (release). Plus polish in `docs/demos/` scripts (concrete repo recommendation, realistic timing, `--auto-commit`, `npm install` safety net). New `TODO-post-talk.md` with the 8 P1/P2 findings deferred to post-talk. 4 359 tests passing.

## Phase 61.2: Patch — `kj init` wizard expansion (v2.10.2)

**v2.10.2** (patch, 2026-05-07) — `kj init` goes from 9 prompts to a full setup. New `askPerRoleProviders` walks all 10 non-coder/non-reviewer roles (planner, researcher, architect, refactorer, tester, security, solomon, impeccable, perf, hu_reviewer) offering "inherit from coder/reviewer", pick a specific CLI, or disable. New `src/sonar/token-bootstrap.js` logs in to the local Sonar with admin/admin, **rotates the default password** to a fresh secret persisted at `~/.karajan/sonar.admin-password` (mode 0600), revokes any pre-existing `karajan-cli` token and generates a fresh `GLOBAL_ANALYSIS_TOKEN` via `POST /api/user_tokens/generate` — no more walking through the web UI. New prompts for git automation (`auto_commit/push/pr` + `branch_prefix`) and HU Board security (bind host + port). Triggered by user feedback during pre-talk testing on 2026-05-06: "el init es minimalista, falta configurar el resto de roles con qué CLI". PR #616 (KJC-TSK-0367) + #617 (release). +16 new tests; **4 375 / 4 375** passing across 374 files.

## Phase 62: Dogfooding pass — UX papercuts + zombi-status fixes + hu-board polish (v2.11.0)

**v2.11.0** (minor, 2026-05-08) — Two-day pass through a 10-level dogfooding plan re-validated every Karajan surface (N0 sanity → N8 demo scripts) and surfaced a long tail of UX papercuts and three latent bugs that only show up on fresh `/tmp/...` repos. 14 PRs (#624–#637).

**Pipeline reliability**: The `SonarStage` no longer loops on remoteless repos (`KJC-TSK-0373` follow-up, #624 + #633) — pre-fix it threw `Missing git remote.origin.url` on every iteration, Brain treated each error as unresolved, and the run finalised via the "approved-by-exhaustion" fallback without ever running Sonar. New shared `canResolveSonarProjectKey` predicate skips the stage cleanly with `gateStatus: SKIPPED`. Locale-aware `commitAll` race tolerance (#633) catches `nothing to commit` / `nada para hacer commit` / `nichts zu committen` / `aucune modification ajoutée au commit` and returns `{committed: false}` cleanly instead of escalating to Solomon. HU-branch fallback (#636): when `init.defaultBranch=master` and the configured `main` doesn't exist, `prepareHuBranch` probes `main → master → HEAD` and uses the first ref that exists — pre-fix every HU silently fell back to the original branch, voiding the per-HU isolation.

**Session status sealing** (`KJC-BUG-0037`, #635): several `runFlow` exit paths returned `{approved: true}` upstream without sealing `session.status`, leaving runs at `running` indefinitely (`kj status` showed "Pipeline RUNNING" forever; the HU Board carried perma-zombies until the 6 h reaper). New boundary guard `sealSessionStatusIfStillRunning` at the runFlow return points maps the result shape to the terminal status (`approved` / `paused` / `cancelled` / `failed`); idempotent + never-throws.

**`writeConfig` strips runtime-only keys** (`KJC-BUG-0036`, #629): the loader synthesised `_deprecated.sonarqubeEnabledKey` and the wizard used `sonarqube.enabled` as a transient hint; `writeConfig` was serialising both, fossilising the deprecation warning into the user's YAML. New `stripRuntimeOnlyKeys` removes both before YAML dump. `addyosmani-catalog` recovers from upstream force-push (`KJC-BUG-0033`, #625): when `git pull --ff-only` fails, fall back to `git fetch --depth 1 origin HEAD` + `git reset --hard FETCH_HEAD`. `kj init` no longer persists the deprecated `sonarqube.enabled` (`KJC-BUG-0034`, #626) — wizard answer survives in memory as a hint for `setupSonarQube` but never reaches disk.

**hu-board features**: Auto-cleanup of ephemeral test projects (`KJC-TSK-0371`, #627) cascade-deletes `tmp_*` / `test_*` / `demo_*` / `kj-test-*` projects inactive >24 h on board start. New `is_test` column on `projects` lets the user override per-project (3-state toggle 🧪 / 📌 / · on each card; `PATCH /api/projects/:id/is-test` endpoint). In-UI help (`KJC-TSK-0372`, #628): new `?` button opens a modal explaining the five views; every nav tab carries a native `title` attribute for the standard hover tooltip.

**UX / display polish**: Sonar `SKIPPED` renders gray, not red, in the result banner (#634) — three colour buckets now (`OK` green / `SKIPPED|PENDING` gray / else red). Result panel + `summary.md` now list **every** commit the run produced via the new `listCommitsBetween(fromSha)` helper plus a new `session.head_at_start` field captured at run start (separate from `base_ref`/`session_start_sha` which can be the empty-tree SHA on single-commit repos) (#632). Help text says `task` is REQUIRED for the 8 commands that need it (#631) — `kj run / code / review / plan generate / triage / researcher / architect / discover` updated. `kj audit` is intentionally untouched (its positional truly is optional).

**Documentation**: New `docs/dogfooding-levels.md` (#630, #637) with the 10-level test plan reconstructed from the JSONL transcript after a context compaction. Each level has a Histórico / Re-validado entry from the 2026-05-07 dogfooding pass. **4 452 / 4 452 tests** passing across 377 files.

## Phase 63: Quality measurement — plan adherence + golden tasks (v2.12.0)

**v2.12.0** (minor, 2026-05-09) — Two new quality-measurement features land together. The pipeline now scores its *own* runs (per-run **plan adherence**, deterministic 0–100 metric in `summary.md`) and the project as a whole protects itself against version-to-version regression with a small **golden-tasks** suite. Plus a CI policy refinement that frees human-facing documentation from the LOC budget while keeping AI-rule files capped. 8 PRs total (#645–#652) + the release commit #653.

**Plan adherence metric** (`KJC-TSK-0376`, #645/#646/#647): every `kj run` against a known plan computes a deterministic 0–100 score answering *"did the coder follow the plan?"*. Four weighted components — commit attribution (40%), acceptance tests (30%), scope discipline (20%), dependency order (10%) — pure offline calculation, no LLM, no extra cost. Inspired by [deepeval's](https://deepeval.com/guides/guides-ai-agent-evaluation) agent-evaluation guide but kept fully deterministic for reproducibility (golden-task suite friendly). Surfaces in `summary.md` as a new `## Plan adherence` section with score, breakdown table, and the list of HUs that didn't get an attributed commit. Section is omitted when the run wasn't bound to a plan or every component returns null. Spec in [`docs/plan-adherence.md`](https://github.com/manufosela/karajan-code/blob/main/docs/plan-adherence.md).

**Golden tasks regression suite** (`KJC-TSK-0374`, #648/#650/#651/#652): three canonical task fixtures (`todo-rest-api`, `npm-package-cli`, `react-counter-component`) with structural assertions on the produced `summary.md` (commits, audit status, plan adherence threshold) plus filesystem checks (test files, LOC range). The suite runs pre-release (~$5–10 per full pass) and produces `{ok, kjExit, summaryPath, parsed, failures}`. Five assertion families per task, all deterministic. Three orthogonal domains (backend / CLI / frontend). The four sub-PRs split: schema + loader, summary parser + asserter, subprocess runner + filesystem assertions, fixtures + baseline + spec doc. Spec in [`docs/golden-tasks.md`](https://github.com/manufosela/karajan-code/blob/main/docs/golden-tasks.md).

**Shrink-budget refined** (#649): the 200-LOC PR ceiling was forcing artificial truncation of legitimate documentation (CHANGELOG entries, spec files). The gate now exempts human-facing docs (`docs/**`, `CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATION*.md`, `TODO*.md`). AI-rule files (`CLAUDE.md`, `AGENTS.md`, `templates/**/*.md` — role prompts, coder/review rules) **still count** — those go into the agent's context window every run, and unbounded growth there dilutes the signal the AI receives. Same ≤200 LOC discipline as code. **4 522 / 4 522 tests** passing across 381 files.

## Phase 64: HU Board hardening — tombstones + restart detector + cleanup (v2.13.0)

**v2.13.0** (minor, 2026-05-11) — Cinco PRs absorben las patologías que la sesión de dogfooding del 2026-05-10 reveló sobre el HU Board: un modal "Karajan needs an answer" del 7 de mayo bloqueando toda la UI, ~18 proyectos zombi reapareciendo tras cada `kj board start`, el navegador sirviendo HTML/JS antiguo tras un `kj board stop` + `start`, y el modal del prompt mostrando transparencia porque `var(--bg-secondary)` jamás se declaró. No band-aids — refactor estructural por causa raíz.

**Tombstones — delete persistente** (`KJC-TSK-0380`, #655/#656/#657): el HU Board reconstruye la DB SQLite desde el filesystem en cada `fullScan`, así que cualquier `DELETE` por API era silenciosamente revertido al siguiente sync de chokidar. Solución: tabla `tombstones (resource_type, resource_id, deleted_at, source, fs_paths)` con clave primaria compuesta. Los `sync*File` consultan tombstone antes de upsert; si está, hacen `rm -rf` del path del filesystem y abortan. Patrón clásico de Cassandra/Riak. Permanentes; restauración explícita vía endpoint. Endpoints DELETE reforzados (`/api/projects/:id`, `/api/stories/:id`, `/api/sessions/:id`) y nuevos (`DELETE /api/prompts/:id`, `DELETE /api/plans/:planId`, `GET /api/tombstones`, `POST /api/tombstones/:type/:id/restore`). Comando nuevo `kj board cleanup` detecta proyectos efímeros (`tmp_*`/`test_*`/`demo_*`/`kj-test-*`/`s_*`/`plan-*` con >7d sin actividad), prompts huérfanos (sin `.answer.json` y mtime >24h) y directorios de sesión huérfanos. Soporta `--dry-run`. Resuelve los ~20 zombis acumulados en una sola pasada.

**Server-restart detector** (`KJC-TSK-0379`, #654): `Cache-Control: no-store, must-revalidate` para HTML/JS/CSS servidos por el board (ETag y Last-Modified desactivados) garantiza que el primer request tras un restart trae código fresco. El cliente polea `/api/version` cada 30s; si `boot_time` cambia (server reiniciado), `forceRefresh()` automático: limpia caches y recarga sin que el usuario tenga que cerrar pestañas o hacer Clear Site Data. Botón **🧹** en el header como escotilla manual visible.

**Polish UX** (#658): `var(--bg-secondary)` referenciada en 8 sitios de `app.js` (modal del prompt, textareas, inputs, code blocks) pero jamás declarada en `:root` → fallback a `transparent` → cards visibles detrás. Fix: declarar la variable en `:root` con `#131a30`. Una línea CSS, ocho consumidores arreglados. Y el icono `☐` (cuadrado vacío Unicode U+2610) del empty-state, eliminado del template — el title + text + path bastan.

**4 522 / 4 522 tests** passing. Safe upgrade from 2.12.0.

## Phase 65: Quality pass — Solomon classification + planner self-fix + tests reorg (v2.14.0)

**v2.14.0** (minor, 2026-05-12) — 16 PRs en una sesión absorbiendo bugs blockers, patologías del planner detectadas en el dogfooding de Plan 2 GRETA, hardening del HU Board, y la primera tanda de reorg de `tests/` (issue #368). Suite 4577/4577 verde toda la sesión, 0 regresiones.

**Solomon ya no aprueba security blockers erróneamente clasificados como "style"** (`KJC-BUG-0026`, #665): la Rule 6 (`reviewer_style_block`) clasificaba cualquier issue con severity `low`/`minor` O regex de keywords cosméticas (`name`, `format`, `documentation`, …) como style. Issues de seguridad legítimos con esas características (e.g. "SQL injection in user input parsing" matcheaba `name`, "Missing CORS documentation" matcheaba `documentation`) acababan en el ojo de Solomon que los aprobaba. Fix: anti-clasificador `isSecurityIssue()` con tres señales — severities `critical`/`high`/`blocker`/`major`, categorías `security`/`correctness`/`bug`/`vulnerability`, y una regex de security keywords (sql injection, xss, csrf, ssrf, rce, auth, password, secret, credential, token, hash, crypto, traversal, prototype pollution, deserializ, eval, …). Si CUALQUIERA de las señales matchea, la lambda devuelve `false` para `allStyle` y Solomon no se invoca.

**Detector de fs-leak del coder, segunda capa** (`KJC-BUG-0032`, #666): el `fs-leak-detector` original snapshotteaba `$HOME` antes/después del coder y diffeaba top-level entries. Capturaba el incidente original (`cd /home/manu/assistant && pnpm init` creando 36 MB) sólo porque `~/assistant` era nuevo. Si el target preexistía, pasaba inadvertido. Fix: nueva función `detectTranscriptCdLeaks(transcript, projectDir)` que escanea el output del coder buscando patrones `cd <ruta-abs> && <write-cmd>` con `<ruta-abs>` fuera de `projectDir` y `<write-cmd>` en el set de creación (`mkdir`, `touch`, `cp`, `mv`, `git init`, `{pnpm,npm,yarn} init/create`, `npx create-*`, `cat >`, `echo >`, redirects). Pure-read commands (`ls`, `which`, `grep`) no flagean. `/tmp` exento. Las dos capas se unifican en `coder-stage.js`; si cualquiera detecta leak, `formatLeakMessage()` aborta la iteración.

**Patologías del planner P1-P4 detectadas en dogfooding de Plan 2 GRETA** (2026-05-11): el reviewer flagaba sistemáticamente 4 huecos del SPEC en cada iteración. P1 (#667 / `KJC-BUG-0042`) — el planner ignoraba declaraciones explícitas tipo "NO incluye en este plan: vistas compartidas, X, Y", "Out of scope: real-time sync", "Plan N handles: cross-tenant views". Fix: `extractScopeExclusions(task)` detecta 6 patrones (ES + EN) y renderiza una sección **FORBIDDEN scope** en el prompt con instrucción "do NOT generate steps for these items". P2 (#668 / `KJC-BUG-0043`) — el planner no inferia deps transversales uno-a-muchos: una HU con AC "listado transversal de warnings filtrables por guardrail" solo declaraba `dependencies: [GUARD-001]` cuando debía depender de `GUARD-001..N`. Fix: regla explícita en el prompt — "if a step requires ALL members of a category, declare deps to ALL of them, NOT just the first" + ejemplo concreto. P3 (#669 / `KJC-BUG-0044`) — el planner reimplementaba funcionalidad ya cubierta por otra HU. Fix: nuevo campo `reuse: ["<id>"]` end-to-end (prompt schema + `addHu`/`removeHu`/`updateHu` + pass-2 de resolución en `generate.js`). P4 (#670/#671 / `KJC-BUG-0045`) — el plan-reviewer era flag-only: surfaceaba `missing_hus`/`missing_dependencies`/`scope_overlaps` y los dejaba para que el usuario los aplicara a mano. Fix: nuevo módulo `src/plan/plan-fixer.js` con `buildFixerPrompt({ task, hus, findings })` que pide al planner un patch estructurado, `applyReviewerFeedback({ agent, ... })` que ejecuta el agent + parsea + normaliza, y `applyFixerPatch(plan, patch)` que muta el plan in-place (`additions` → `addHu`, `deletions` → `removeHu` con cleanup de dangling refs, `deps_to_add` → merge `blocked_by` sin duplicar). Loop max=2 iteraciones tras `reviewPlan`, opt-out con `--no-plan-fixer`/`--quick`.

**HU Board polish**: prompts zombi (`KJC-BUG-0038`, #673) — si el runner crasheaba sin contestar a `askQuestion`, el archivo `~/.kj/prompts/<id>.json` quedaba huérfano y cada reload del board mostraba el modal "Karajan needs an answer" sin runner detrás. Fix: TTL de 30 min en `GET /api/prompts`. Si `parsed.createdAt` (con fallback a `mtime`) es más viejo, `unlink` + `addTombstone` + skip. Rate-limit (`KJC-BUG-0039`, #674) — el rate-limit estaba en 300 req/min por IP; el fanout del primer load del board + múltiples tabs + reconnects SSE podían sobrepasarlo y devolver 429 al usuario en su primer click. Fix: default 300→600 con env var `HU_BOARD_RATE_LIMIT` para override + `skip:` para `/api/events` (SSE es 1 conexión persistente, reconnects automáticos del browser no deberían contar).

**Tests reorg (issue #368, parcial)**: el directorio `tests/` tenía 264 archivos en root sin estructura clara. 5 PRs (#675–#679) movieron 93 archivos a 13 subcarpetas espejo de `src/` (`tests/plan/`, `tests/hu/`, `tests/sonar/`, `tests/board/`, `tests/session/`, `tests/triage/`, `tests/domain/`, `tests/agents/`, `tests/brain/`, `tests/reviewer/`, `tests/security/`, `tests/utils/`, `tests/coder/`, `tests/solomon/`, `tests/skills/`, `tests/roles/`). Cambios mecánicos: `git mv` (preserva history como rename) + `sed` para 6 patrones de imports relativos (`from "../src"` → `"../../src"`, `vi.mock`, `vi.doMock`, `import()`, `./fixtures` → `../fixtures`, `import.meta.dirname, ".."` con `templates/` path.resolve). Quedan ~170 archivos en root para próximas oleadas.

## Phase 66: Patch — Self-fix convergence guard + async-deps respect (v2.14.1)

**v2.14.1** (patch, 2026-05-12) — 2 PRs absorbiendo las patologías del planner que el dogfooding de v2.14.0 contra GRETA Plan 2 reveló a las pocas horas de release.

**Self-fix loop divergence** (`KJC-BUG-0046` / P5, #684): el self-fix loop introducido en v2.14.0 podía empeorar el plan en lugar de mejorarlo. El dogfooding mostró que iter 1 reducía 15→10 issues pero iter 2 borraba HUs que iter 1 había añadido, dejando referencias dangling que el reviewer post-iter-2 contaba como nuevos `missing_dependencies`, terminando en 17 findings — peor que antes de iter 2. Fix: snapshot del plan (`JSON.parse(JSON.stringify(plan.hus))` + `plan.review`) ANTES de aplicar cada patch del fixer. Tras re-review, si `newCount > currentCount`, restaurar el snapshot y `break` el loop. Log nuevo en `run.log`: `[planner] self-fix iter 2 regressed (10 → 17) — reverted, stopping`. La cota inferior queda fijada en `min(reviews observados)` en lugar del último review.

**Async-deps respect** (`KJC-BUG-0047` / P6, #685): el planner convertía sistemáticamente "Y reacciona a X" en `X blocked_by Y`, rompiendo el principio "AVISA-no-BLOQUEA" que GRETA define para sus guardarraíles. Ejemplo del Plan 2: 4 de 5 order_issues del reviewer eran del mismo patrón ("041 Outcome blocked_by 052 Guardarraíl 1 — pero G1 es async y NO bloquea creación"). Fix: regla explícita añadida a la sección `dependencies` del prompt del planner enumerando 6 patrones de async observers — (a) guardrails/validators/monitors, (b) cron jobs / scheduled tasks, (c) webhooks / event handlers / listeners, (d) async queues / workers / pipelines, (e) audit logs / metric collectors, (f) "validator" / "monitor" steps que corren después — junto con una heurística clara: "¿X CONSUME un deliverable que debe EXISTIR antes de X empezar?" → `blocked_by`. "¿Y solo REACCIONA a X después?" → NO `blocked_by`, paralelos.

**Resultado del dogfooding**: regenerar Plan 2 GRETA contra v2.14.1 devuelve **9 findings sobre 58 HUs** (15% issue density), igualando el baseline iter 1 de v2.13.0 + #661-#664. v2.14.0 puro devolvía 17 findings. Reducción del 47% en findings iniciales gracias a P6 (15→9 antes de cualquier iter del fixer); P5 evita que cualquier iter posterior empeore el resultado. Las 9 patologías restantes son gaps reales del SPEC (`dimension_link` no cubierto, envelope encryption del `reasoning` IA emocional faltante, cascada GDPR sin algunas deps implícitas), no fallos del planner — son ediciones manuales tras revisión.

## Phase 67: Patch — ▶ button respects blocked_by + [EPICA] prefix + spec-conventions docs (v2.14.2)

**v2.14.2** (patch, 2026-05-12) — 2 UX bugs + 1 docs gap from GRETA Plan 2 dogfooding v2.14.1.

**Botón ▶ Run respeta blocked_by** (`KJC-BUG-0048`, #687): el cálculo `canRunHu` en `packages/hu-board/public/app.js` solo miraba `status + testCount`, así que el botón ▶ se pintaba en TODAS las HUs `pending`, permitiendo lanzar HUs cuyas deps aún no existían. El frontend ya pintaba "⏳ waits for: …" debajo del título pero el botón ▶ aparecía igual. Fix: añadir `&& blockedBy.length === 0` al `canRunHu`. La variable `blockedBy` ya estaba en scope (línea 944).

**[EPICA] prefix en titles del planner** (#687): durante la evolución v2.14.x, los titles perdieron el prefix `[NOMBRE_EPICA]` que orientaba al usuario sobre qué área del plan pertenecía cada HU. Fix: añadir sección `\`description\` (REQUIRED — MUST start with \`[EPICA] \` prefix)` al prompt del planner. El primer carácter del `description` se convierte en el title del board tras truncar a 80 chars (en `commands/plan/generate.js:127`), así que el prefix sale automático. Heurística: identificar la EPICA del task text (`### Épica NOMBRE`, `## Phase X`, categorías repetidas como `INFRA`/`SHARED`/`UI`/`API`). Fallback: `[INFRA]` para setup, `[SHARED]` para cross-cutting. Dogfooding GRETA Plan 2 produce 62/62 HUs con prefix correcto (PROFILE, ASSESS, AI, IMPACT, GUARD, INFRA, CATALOG).

**`spec-conventions.md` documento central** (`KJC-TSK-0385`, #688): el usuario observó que las plantillas existentes (PR #664 / TSK-0378) cubrían parcialmente las convenciones del task file, pero faltaban las patologías nuevas descubiertas en v2.14.x. Nuevo documento `docs/task-templates/spec-conventions.md` (191 LOC) con las **6 convenciones** que el planner v2.14.x entiende: (1) épicas con `### Épica NOMBRE`, (2) scope exclusions `NO incluye en este plan: …` (6 patrones ES + EN), (3) deps transversales `TODOS los X`, (4) reuse marker, (5) async observers (AVISA-no-BLOQUEA), (6) deps explícitas. Más tabla de antipatrones detectados en dogfooding y checklist pre-generación. La plantilla `plan-generate.md` se actualizó con banner + 4 secciones 📘 invocando estas convenciones, y el README de task-templates destaca el documento central.

## Phase 68: Patch — Preflight degradable + project-aware (v2.14.3)

**v2.14.3** (patch, 2026-05-13) — 3 mejoras al sistema de preflight surgidas del primer `kj run` real sobre greta-app (proyecto greenfield).

**Gh keyring auth recognized** (`KJC-BUG-0049` puntual, #690): el check `token:gh` solo miraba `process.env.GH_TOKEN || GITHUB_TOKEN`. Cuando `gh` estaba autenticado vía keyring/OAuth (caso default tras `gh auth login --web`), Karajan rechazaba con FAIL aunque la auth estuviera operativa. Fix: ejecutar `gh auth status` como fallback antes de fallar.

**Degradable checks system** (`KJC-BUG-0049` arquitectural, #691): nuevo campo `Check.degradable = { disables: ["git.auto_pr", ...], warn: "..." }`. Cuando un check degradable falla, en lugar de abortar el preflight, desactiva los flags listados en `disables` y emite WARN. La sesión continúa con esas features off. Reemplaza el patrón "fail-closed" rígido por "degrade-or-fail" según la naturaleza del check. El check `token:gh` ahora es degradable: si `gh` no auth, se desactivan `auto_pr` + `auto_push` y el coder sigue haciendo commits locales (no PRs).

**Project-aware preflight** (`KJC-TSK-0393`, #691): el `kj doctor` global y el preflight estándar comprobaban el ENTORNO de Karajan (CLIs, node, dirs ~/.karajan/, sonar). Nada validaba que el PROYECTO actual tuviera lo necesario. Nuevo módulo `src/checks/project-checks.js` con signal detection + checks dinámicos: detecta signals (`package.json`, `Dockerfile`, `firebase.json`, `pyproject.toml`, `Cargo.toml`, `*.tf`, `.env.example`) y registra los checks correspondientes (tool presente, permisos write, .env consistency, gh remote access — este último degradable). Comando nuevo `kj doctor --project` ejecuta solo esta fase, útil para validar un proyecto antes de `kj run` sin re-correr todos los checks globales.

## Phase 69: Brain Recovery + Model Routing + Self-Healing Plans (v2.15.0)

**v2.15.0** (minor, 2026-05-17) — tres epics simultáneos cierran tres problemas distintos en una release. 30+ commits, ~4 000 LOC, 4 835/4 835 tests passing.

**Epic KJC-PCS-0044 — Brain Recovery** (TSK-0411…0415, 11 PRs #722-#736). Hasta v2.14 cualquier fallo de IA (rate limit, 5xx, network, kill por silence timeout) terminaba con un genérico `failed (Ns)` sin diagnóstico. v2.15 introduce un **classifier universal** con 7 clases ricas (RATE_LIMIT_SHORT, QUOTA_EXHAUSTED_DAILY, QUOTA_EXHAUSTED_MONTHLY, API_DOWN, AUTH_FAILED, NETWORK_TIMEOUT, SILENCED, UNKNOWN_FATAL) y un **wrapper central** `withBrainRecovery` que wrappa TODA invocación a agente y aplica política según clase: standby in-process para waits < 5 min, backoff exponencial con jitter para 5xx/network/silenced, abort para auth/unknown, **hibernate** para quota daily/monthly. La hibernación persiste el estado del run a `~/.kj/standby/<sessionId>.json`, mata el proceso (libera memoria), y el board reanuda con `kj standby resume` exactamente cuando llega `cooldownUntil` (setTimeout único per session, cero polling). El GC al arrancar limpia standby/done > 7d, audits > 30d, hu-board-runs > 30d (resuelve 25 carpetas huérfanas detectadas en dogfooding). Para Anthropic Max 20x que introduce un cap de \$200/mes Agent SDK desde 15-jun-2026, una nueva clase QUOTA_EXHAUSTED_MONTHLY y un **fallback chain** (claude → codex → opencode → aider, configurable per rol en `kj init`) activa el siguiente provider cuando `retryAfter > 12h` en lugar de hibernar 30 días.

**Epic KJC-PCS-0043 — Model Routing per HU + Undo** (TSK-0405…0410, 6 PRs #715-#721). Cada HU lleva `coder_model` + `reviewer_model` propios, asignados automáticamente según complexity (trivial/simple/medium/complex) inferido del task_type. Reviewer **cross-provider** por defecto (claude↔codex, gemini→claude, opencode→claude) — dos cabezas distintas miran el código. Override per-HU desde el modal del board sin tocar config global. OpenCode + Aider son first-class providers en el router. Antes del coder run, un git snapshot ref se crea automático; botón **⏪ Undo** en el modal restaura los ficheros (`git reset --hard <ref>`) y marca status=pending — útil cuando el resultado no convence y quieres re-ejecutar con otro modelo.

**Epic KJC-PCS-0042 — Self-Healing Plans** (BUG-0053/0054, TSK-0399…0404, 8 PRs #707-#714). El plan-fixer ahora **asigna short_id + blocked_by** a las HUs que añade en iteraciones del self-fix loop (antes quedaban con id largo críptico y deps no resueltas). El **convergence guard** se vuelve inteligente: distingue *priority* (cycles + missing_hus, crítico) de *secondary* (deps + overlaps) y acepta iteraciones que reducen priority aunque suban secondary. Tras el self-fix LLM corre un **structural integrity pass** determinístico que rompe ciclos (DFS), elimina blocked_by huérfanos y asigna `AUTOFIX-NNN` a HUs sin short_id — porque el LLM es bueno con contenido pero malo con grafos. Nuevos task_types `spike` y `research` (skip Sonar/TDD/tests), title prefix `[SPIKE]`/`[DOC]`/`[RESEARCH]` infiere task_type automático. Nuevo comando `kj plan fix [planId] [--prompt "feedback"]` re-corre reviewer + self-fix + structural pass sobre un plan existente sin regenerar. La columna Failed del kanban del board desaparece — HUs fallidas vuelven a Pending con badge ✗ result=fail, disponibles para retry inmediato.

## Phase 70: Sonar false-positive filter + Brain Recovery wire complete (v2.16.0)

**v2.16.0** (minor, 2026-05-18) — release orientado a calidad. 4 PRs (#738-#741), 4 846/4 846 tests passing en 401 ficheros. La cabecera es un **filtro determinístico de falsos positivos de Sonar** (KJC-TSK-0416). Antes de v2.16 cualquier issue Sonar de severidad ≥ MINOR aterrizaba en el feedback del coder (rol `sonar-role`) o del auditor sin más; reglas con falsos positivos crónicos como `javascript:S2699` ("test sin assert") en `tests/architecture/` (donde el assert es `expect(offenders, msg).toEqual([])` con mensaje custom que Sonar no ve) provocaban que el coder gastara tokens "arreglando" tests que ya pasaban. v2.16 introduce dos mecanismos complementarios: (1) **rules estáticas** `{ rule, filePattern, reason }` desde un catálogo built-in extensible per project vía `config.sonar.false_positives`; (2) **inline ignores** con `// karajan-sonar-ignore: <ruleId>` en la línea del issue (o la anterior), útil para falsos positivos puntuales sin tocar config. Issues filtrados quedan registrados con `_suppressedBy` para auditoría. El catálogo built-in arranca con la regla `javascript:S2699` para `tests/architecture/` y crece según los hallazgos del dogfooding.

**TSK-0413 step D — wire universal de Brain Recovery completado** (#739). El módulo `semantic-detector` usaba la signature legacy `runTask(prompt, opts)` mientras `withBrainRecovery` espera `runTask({ prompt, timeoutMs })`. Un adapter inline en el módulo normaliza la llamada. Era el último caller legacy del pipeline — ahora **todas** las invocaciones a agentes IA pasan por el clasificador universal de Brain Recovery, sin excepciones. Test confirma skip-on-fail intacto: en test env el sleep del wrapper es no-op, el abort viene rápido, semantic detection sigue siendo best-effort.

**Codemod `.replace(/regex/g, …)` → `.replaceAll(/regex/g, …)` en 41 sitios de `src/`** (#738). Mismo comportamiento (replaceAll exige flag `/g`, replace con `/g` lo hacía global por accidente). Semántica explícita, detectada por el propio `kj audit` v2.15.0 como hint de modernización ES2024. El alias `planCommand` se eliminó a favor de `planGenerateCommand` (16 call sites en tests actualizados con `sed` rename). Cero alias muertos en superficie pública del CLI.

**Audit cleanup — BLOCKER false positives refactorizados** (#740). Tests de arquitectura usaban `expect(offenders, "msg").toEqual([])` con mensaje custom como segundo argumento de `expect()`. Sonar no detecta el assert así. Refactor: extraer el mensaje a una variable previa, `expect(offenders).toEqual([])`. Reduce el BLOCKER count del `kj audit` v2.15.0 en 11 (todos eran falsos positivos del mismo patrón, no test sin assert real). Limpieza puntual antes de v2.16, no requiere config porque ya están corregidos.

## Phase 71: Audit deterministic structural collectors — knip + madge (v2.17.0)

**v2.17.0** (minor + breaking engines, 2026-05-18) — 4 PRs (#743–#746), 4 872/4 872 tests passing en 402 ficheros. La conversación interna que motiva esta phase es importante: el dogfooding y el análisis de CodeGraph (npm `@colbymchenry/codegraph`, knowledge graph SQLite-backed) propusieron integrarlo en Karajan para enriquecer triage/coder/reviewer con un índice semántico del repo. La decisión razonada fue **no integrarlo**: el value-prop de CodeGraph (94 % fewer tool calls en exploración interactiva) no traslada a un orquestador donde el scope ya viene acotado por el planner; el coste (SQLite, tree-sitter wasms, worker threads con WASM heap leak workaround, FileLock cross-process, hard-exit en Node 25) contradice la filosofía declarada de mantener KJ simple. La alternativa: atacar los **mismos problemas** (dead code, ciclos de imports) con dos herramientas npm puras y maduras — **knip** y **madge** — incorporadas como `dependencies` directas para que `kj audit` las consuma siempre, sin opt-in.

**Madge circular-deps collector** (#744) — dimensión `architecture`. Detecta cadenas de import circulares vía `madge` invocado programáticamente. Stack-aware: solo activa si el stack contiene JS/TS; proyectos Python/Go/Rust devuelven `available:false` y el audit continúa. Honra `tsconfig.json`/`jsconfig.json` para path-aliases. Excludes built-in: `node_modules`, `dist`, `build`, `coverage`, ficheros `.test.*`/`.spec.*`. Timeout 60 s. Severidad heurística por longitud de cadena: ≥4 ficheros = MAJOR (refactor obligatorio típicamente), 2–3 = MINOR. Findings se renderizan en el `deterministic-summary` y se inyectan al prompt del auditor con regla `madge:circular-import` para que el LLM los fold en la dimensión architecture sin tener que adivinarlos.

**Knip dead-exports collector** (#745) — dimensión `codeQuality`. Detecta exports/tipos sin uso (severidad MINOR — pueden ser superficie pública para downstream) y **ficheros sin uso** (severidad MAJOR — casi siempre dead code real). Stack-aware: solo activa si hay `package.json` + JS/TS. Subprocess via `node <knip-bin> --reporter json --no-progress --no-exit-code`, timeout 120 s, buffer 16 MB. Path al binario resuelto via `require.resolve("knip")` + path math, porque knip restringe su `exports` field a `.` y `./session` y no expone `bin/`. Reporta hasta 100 unused-exports/types + 50 unused-files por scan (los excedentes quedan registrados en `truncated`).

**Generalised FP filter** (#743) — el filtro determinístico de falsos positivos de Sonar introducido en v2.16 (TSK-0416) se generaliza a todos los collectors. `src/sonar/issue-filter.js` se mueve a `src/audit/issue-filter.js` con shape extendido: cada rule lleva `{ tool, rule, filePattern, reason }`. Nuevo marker inline `// karajan-audit-ignore: <tool>:<ruleId>` funciona para cualquier collector; el legacy `// karajan-sonar-ignore: <ruleId>` sigue funcionando solo para issues con tool="sonar". `config.audit.false_positives` es la nueva config canónica; `config.sonar.false_positives` queda como alias retrocompatible (entradas tratadas con tool="sonar" implícito). Compat shim en la ruta antigua para no romper imports.

**Built-in FP catalogue** (#746) — 4 entradas shipped por defecto que cubren los falsos positivos más obvios de los nuevos collectors: `knip:unused-files` en `tests/fixtures/` (cargados por path en runtime, knip no los ve), `knip:unused-files` en `examples/` (entry points user-facing), `knip:unused-exports` en barrel files `index.{js,ts,mjs,cjs,jsx,tsx}` (legitimate public API surface aunque no haya in-tree caller), `madge:circular-import` en `node_modules/` (defensive, problema de upstream).

**BREAKING engines** — Node `>=20.10.0` → `>=20.19.0` (requisito de knip 6.x). Mismo patrón que el bump v2.8.0 (18 → 20.10). Usuarios en 20.10–20.18 deben actualizar a 20.19+ o 22.12+ antes de instalar 2.17.

**SEA bundle**: knip + oxc-parser + oxc-resolver + madge añadidos a `external` en `esbuild-sea.config.mjs`. Las llamadas `require.resolve("knip")` y `await import("madge")` fallan limpio en el binario standalone → los collectors devuelven `available:false` y el audit continúa sin esas secciones. npm installs tienen las deps en `node_modules` y funcionan normal. Mismo patrón ya usado para `better-sqlite3` + hu-board en v2.13.

Con esto, `kj audit` queda con **5 collectors deterministas** (sonar, osv, semgrep, madge, knip), todos pasando por el mismo FP filter, todos con flag `--no-*` para desactivarlos puntualmente, y todos con stack gating que los hace no-op en proyectos donde no aplican.

## Phase 72: Home directory consolidation — ~/.kj/ into ~/.karajan/ (v2.19.0)

**v2.19.0** (minor, 2026-05-23) — 3 PRs (#781, #782, #783) closing the [KJC-PCS-0047 epic](https://planning-game.web.app). The HOME-level state of Karajan was split between two directories without an ADR: `~/.kj/` held plans, hibernated standby state, run-registry entries and worktrees; `~/.karajan/` held sessions, hu-stories, config, webperf, domains and roles. Four divergent `getKjHome()` implementations had drifted across `src/plan/plan-store.js`, `src/brain/standby-store.js`, `src/utils/garbage-collector.js` and `packages/hu-board/src/db.js` (the last one was already on `.karajan/` but kept the legacy name). New users could not find their plans; teams could not predict where state lived.

**PR #781 — unify the resolver.** New `src/utils/paths.js::resolveHome({ defaultSegment })` is the single source of truth. Precedence: `KARAJAN_HOME` > `KJ_HOME` (with a one-shot per-process `[warn] KJ_HOME is deprecated, rename to KARAJAN_HOME`) > VITEST tmp > `~/<defaultSegment>`. The VITEST root is unified as `karajan-vitest-<pid>-<rand>/<segment>` so plan-store (`.kj`) and db.js (`.karajan`) can share one tmp prefix per test run. Three modules drop their own `getKjHome()` (~30 LOC removed each) and import the resolver. Defaults intentionally NOT changed in this PR — only mechanism. +156 LOC net, 8 new precedence tests pass.

**PR #782 — auto-migrator + CLI hook.** New `src/utils/home-migration.js::migrateKjToKarajan()` runs on every `kj` invocation. Idempotent via `~/.karajan/.kj-migrated.json`. Tarball backup at `~/.karajan/backup/kj-pre-migration-<ISO>.tar.gz` BEFORE moving — restore is one `tar -xzf` away. `plans/`, `standby/` and `worktrees/` are moved wholesale; `runs/` is merged with `.karajan/` winning on file-name conflict (it is the canonical runs root used by 4 production code paths). Cross-device safe (`fs.rename` falls back to `fs.cp + fs.rm` on `EXDEV` for overlay mounts, docker volumes, NFS). VITEST guard so tests setting `KJ_HOME` never migrate against the developer's real HOME. Hook in `src/cli.js` is static-imported (the migrator runs on every invocation — no lazy-load benefit, plus the architectural dynamic-imports budget would otherwise grow by one for a permanent caller). +182 LOC net, 5 migration scenarios tested.

**PR #783 — flip every default to `~/.karajan/`.** Plan-store, standby-store and garbage-collector now resolve their segment to `.karajan`. The legacy `getKjHomeLegacy()` is removed (no callers left). The HU Board's `sync.js` `fullScan()` and `startWatcher()` read BOTH `~/.karajan/plans/` and `~/.kj/plans/` so users who start the board before any post-upgrade `kj` command — the trigger of the auto-migrator — still see live updates. New `kj doctor` check `legacy-kj-home` reports unmigrated `~/.kj/` as `warn` severity with the fix line `Run any kj command (e.g. kj doctor) — the migrator runs automatically`. +37 LOC counted (docs excluded), +71 LOC raw.

**User experience.** The first `kj <anything>` after upgrading prints one stderr line:

> `[warn] Migrated 12 plans + 3 standby from /home/user/.kj to /home/user/.karajan (backup: /home/user/.karajan/backup/kj-pre-migration-2026-05-24T....tar.gz)`

Subsequent invocations: silent. Users with `KJ_HOME=...` in their shell rcfile also see once per process: `[warn] KJ_HOME is deprecated, rename to KARAJAN_HOME`. `kj doctor` lists `legacy ~/.kj/ directory` as a check; before migration → `warn` with the fix line, after → `info` (silent).

**Out of scope (backlog).** 38 direct `os.homedir()` calls in config / resolve-bin / devtools / webperf / leak-detector / postinstall bypass the unified resolver — they always write to `~/.karajan/` literally regardless of `KARAJAN_HOME` overrides. Tracked as [KJC-TSK-0420](https://planning-game.web.app); not blocking. Plus 4 code paths still build their own `~/.karajan/runs/` path; tracked as [KJC-TSK-0421](https://planning-game.web.app), pure DRY refactor.

## Phase 73: Patch — kj board start packaging fix + home-consolidation housekeeping (v2.19.1)

**v2.19.1** (patch, 2026-05-23) — 4 PRs (#789, #790, #791, #792 release). One **APPLICATION BLOCKER** fix plus the two follow-ups from the home-consolidation epic. v2.19.0 had shipped with a packaging bug that broke `kj board start` for every user on a fresh `npm install -g karajan-code`.

**Headline fix — #791 (KJC-BUG-0056).** Reported by [@aitormf](https://github.com/aitormf). Two independent root causes combined to break the HU Board feature for every user installing from npm:

1. **`packages/` not in the npm tarball.** The root `package.json::files` array listed `src/`, `bin/`, `templates/`, `scripts/` and a couple of docs — but NOT `packages/`. Confirmed via `npm pack --dry-run`: zero matches for `packages/hu-board/`. Even after `npm install -g karajan-code` completes successfully, the directory simply does not exist on disk and `kj board start` fails before `server.js` can be imported.

2. **HU Board deps not at root.** Even when users copied `packages/hu-board/` manually (the fallback some tried), they got `Cannot find package 'helmet' imported from .../packages/hu-board/src/server.js` — because the five HU Board dependencies (`helmet`, `chokidar`, `better-sqlite3`, `express`, `express-rate-limit`) were declared in `packages/hu-board/package.json` but missing from root `dependencies`. `npm install -g karajan-code` only resolves root deps, not nested non-workspace sub-packages.

Fix: add `packages/hu-board/{src,public,package.json}` to `files`; add the five HU Board deps to root `dependencies` at the exact versions the sub-package declares (so `npm dedupe` collapses to one copy resolvable by upward traversal from `server.js`); regenerate `package-lock.json`. Verified end-to-end: `npm pack` now ships 28 board files (vs 0 before); `node packages/hu-board/src/server.js` boots cleanly.

**Internal — #790 (KJC-TSK-0420).** 38 direct `os.homedir()` callers routed through `src/utils/paths.js` helpers. `KARAJAN_HOME=/some/path kj <anything>` now redirects EVERY component to `/some/path/…` — not just plans / standby / sessions, but also webperf cache, run-registry, board prompt bridge, HU Board auth token, `hu-board.pid`, the board's config viewer, and the `kj doctor` dir-setup check. Three new helpers added (`getWebperfDir`, `getRunsDir`, `getPromptsDir`), and `packages/hu-board/src/db.js::getKjHome` gained `KARAJAN_HOME` priority. The legitimate non-Karajan callers (npm-global bin lookup, fs-leak detector, third-party app configs in `~/.claude.json` and `~/.codex/config.toml`) stay untouched.

**Internal — #789 (KJC-TSK-0421).** 5 inline constructions of `~/.karajan/hu-board-runs/` (one in `garbage-collector.js`, four across the HU Board package) unified under one helper `getHuBoardRunsDir()` in `packages/hu-board/src/db.js`. Pure DRY — no semantic change. Closes the secondary deuda técnica from KJC-PCS-0047.

## Phase 74: Patch — SonarQube 401 auto-recovery (v2.19.2)

**v2.19.2** (patch, 2026-05-23) — 2 PRs (#793 fix, #794 release). Closes [KJC-BUG-0057](https://planning-game.web.app), the second bug Aitor reported on the same day as KJC-BUG-0056. The board fix in v2.19.1 unblocked `kj board start`, but `kj run` and `kj audit` were still failing for him with `SonarQube authentication failed (HTTP 401)` even though admin/admin worked in the Sonar UI.

**Root cause.** `bootstrapSonarToken()` has lived in `src/sonar/token-bootstrap.js` since v2.10.2. It probes admin/admin against the Sonar host, rotates the default password if still in place (persisting the new one to `~/.karajan/sonar.admin-password`), revokes the existing `karajan-cli` token and generates a fresh `GLOBAL_ANALYSIS_TOKEN`. Solid plumbing. But it was **only invoked from `kj init`**. Every other code path that hit Sonar with a missing / stale / revoked / inconsistent-instance token just threw `SonarApiError` HTTP 401 with the hint "Regenerate with `kj init`" — putting the user in the loop for plumbing Karajan has the credentials to do itself.

The user's feedback was unambiguous: *"Si karajan ve que no funciona sonar, que tiene el user/passw, que genere nuevo token, karajan debe tener capacidad de hacer esto y no tiene que hacerlo la IA, es algo programatico."*

**Fix (#793).** New `src/sonar/token-recovery.js` exposing `recoverSonarToken(config, logger)`:

1. **Per-process latch.** One Sonar run that 401s on N endpoints triggers ONE bootstrap attempt, not N.
2. Calls `bootstrapSonarToken({ host: config.sonarqube.host })` — full v2.10.2 code path.
3. **Mutates** `config.sonarqube.token` in place so the immediate retry uses the new token (no config reload).
4. Persists to `~/.karajan/sonar-credentials.json` via `saveSonarToken` so future processes pick it up via the normal resolver chain instead of triggering recovery again.

`src/sonar/api.js::sonarFetchOnce` gains a hidden `_retriedAfterRecovery` flag. On HTTP 401:

- First call → `recoverSonarToken`, then recurse with `_retriedAfterRecovery=true`. If recovery succeeds, the retry uses the new token transparently and the caller never sees the 401.
- Recovery fails → throw `SonarApiError` with a more actionable hint pointing at `~/.karajan/sonar-credentials.json` for saving admin credentials.
- Retry still 401s → throw with a distinct hint about the Sonar instance being inconsistent.

Programmatic. Zero LLM involvement. Reported by [@aitormf](https://github.com/aitormf).

## Phase 74: HU Board canonical home dir (v2.19.3)

**v2.19.3** (patch, 2026-05-23) — Closes KJC-BUG-0059. PR #795. Reported by [@aitormf](https://github.com/aitormf).

The v2.19.0 home consolidation (Phase 72) renamed the canonical plans root from `~/.kj/plans/` to `~/.karajan/plans/` and shipped an auto-migrator that physically moved every existing plan. The migration itself worked — but five call sites under `packages/hu-board/` still had the legacy path baked in as a hard-coded default, surviving the consolidation because Phase 72 only touched `src/`. After the migrator ran (or after a user created any new plan post-v2.19.0), the plans lived under `~/.karajan/plans/<slug>/`; the board kept looking under `~/.kj/plans/<slug>/` and silently found nothing — so the board's UX collapsed even when the rest of `kj` worked perfectly.

The user-visible symptoms were six:

1. `GET /api/projects/:id/preflight` could not extract `projectDir` from any plan → the top card showed `Directorio del proyecto — no detectado` (the literal Aitor saw).
2. `GET /api/projects/:id/plans-outcome` returned `plans: []` for every project that only had post-v2.19.0 plans.
3. `DELETE /api/projects/:id` swept the wrong path, leaving residual `~/.karajan/plans/<slug>/` dirs on disk after a 🗑 delete.
4. `DELETE /api/plans/:planId` scanned the wrong root → silently failed to remove the plan file.
5. `packages/hu-board/src/preflight.js::checkPlans` found no plans even when valid plans existed.
6. `packages/hu-board/src/plan-mutations.js::plansRoot` WROTE new per-HU run logs to the legacy root, splitting state across both dirs and never being GC'd by `cleanup-zombies.js` (which also scanned only the legacy root).

The fix is two-layered, mirroring the resolver discipline established by Phase 72.

**Layer 1 — three new exports in `packages/hu-board/src/db.js`:**

- `getHuBoardPlansDir()` — canonical root (`~/.karajan/plans/`, or `KJ_PLANS_DIR` override).
- `getHuBoardLegacyPlansDir()` — legacy root (`~/.kj/plans/`, null when `KJ_PLANS_DIR` is set so an explicit override cannot dual-scan).
- `getHuBoardPlansDirs()` — ordered `[canonical, legacy?]` for read callers that need to iterate both during the migration window.

**Layer 2 — callers split by intent.** Single-writer paths (`plan-mutations.js::plansRoot`) use the canonical resolver only. Every read / delete / GC path (the four `api.js` endpoints, `preflight.js::checkPlans`, `cleanup-zombies.js`) iterates `getHuBoardPlansDirs()` so users mid-migration with plans still under `~/.kj/` don't get a regression on top of the original bug.

This keeps the board strictly future-canonical for new state (no more splitting writes across both roots) while remaining read-compatible with the legacy root until the auto-migrator from Phase 72 finishes moving everything. The legacy lookup will be removed once Karajan's telemetry indicates the migrator has run on > 99% of installs (tracked via the `.kj-migrated.json` marker file).

29 hu-board test files / 349 tests stayed green through the fix — the existing suite already covered the relevant endpoints by mocking the env vars; the fix unblocked them too. No new tests were strictly required, but a future cohort of integration tests on the legacy-fallback path (planned for v2.20.0) will lock the behaviour in.

LOC budget: +108 / -44, net +64. Inside the 200 hard limit. One PR, one bug card, one release — patch-sized fix for a patch-sized bug.

## Phase 75: kj resume continues from checkpoint + autoInit stops zombie commits (v2.19.4)

**v2.19.4** (patch, 2026-05-24) — two bugs closed in one release. PRs #797 and #798, both reported during the v2.19.3 cycle.

### KJC-BUG-0058 — `kj resume` re-ran researcher + architect + planner (PR #798)

Reported by Aitor Martínez with a screenshot: a session that paused during Sonar, resumed with `kj resume <sessionId>`, showed `[researcher] Read ...` in the terminal log within seconds. The entire pre-loop pipeline — HU-reviewer → intent → discover → triage → domainCurator → researcher → architect → planner — re-executed from scratch. The expensive LLM stages re-ran. Resume's value-prop ("continue from where you stopped") was empty.

Root cause was two-layered. **Layer one**: `resumeFlow` in `src/orchestrator/flow-runner.js:280` loaded the session and called `runFlow` without passing any signal of which stages were already done. **Layer two**: `runFlow` → `initFlowContext` (init-context.js:175) initialised `ctx.stageResults = {}` unconditionally; `runPreLoopStages` (pre-loop.js:62) re-executed every stage. The session DID hold pre-loop outputs in `ctx.stageResults` while it ran — but nothing wrote them back to `session.json`. The state never crossed the process boundary.

Fix is two-layered, mirroring the bug.

**Layer one — persistence.** Two new mutators in `src/session/mutators.js`:

- `setStageResult(session, name, result)` — populates `session.stage_results[name]` and appends `name` to `session.stages_completed[]`. Idempotent on the flat array.
- `setStageBundle(session, name, bundle)` — adds `session.stage_bundles[name]` for cross-stage context the stageResult alone cannot carry. Researcher's `researchContext`, architect's `architectContext` and planner's `plannedTask` are required by downstream stages and live ONLY in memory until the bundle persists them. `setStageBundle` also calls `setStageResult` so legacy readers and the resumeSkip path keep working through one entry point.

**Layer two — driver.** Two closures inside `runPreLoopStages`:

- `persistStage(name, result)` — writes `stageResults[name]`, calls `setStageResult`, calls `saveSession`. Catches save errors and logs `warn` — a flaky FS shouldn't abort a long-running run.
- `resumeSkip(name)` — returns true when `stageResults[name]` is already populated (rehydrated from the loaded session), emits a `stage:skipped` progress event and a log line.

Cacheable sites wrapped: huReviewer (two entry points — first stage and post-triage auto-activation), intent, discover, domainCurator, researcher, architect, planner. Researcher / architect / planner additionally call `setStageBundle` so resume can replay their cross-stage context.

**Triage is NOT skipped on resume.** It produces `roleOverrides` that downstream stages and the Brain decisor depend on; re-running it is the safe path and it is the cheapest pre-loop stage. The heavy stages it gates (researcher, architect, planner) ARE skipped if already complete.

The rehydration entry point is one line in `init-context.js`:

```js
ctx.stageResults = { ...(ctx.session?.stage_results || {}) };
```

That spread is what enables `resumeSkip` to detect completed stages without a new flag threading through the entire chain.

LOC budget: +197 / -43, net +154. Inside the 200 hard / 150 ideal budget. 10 orchestrator test files / 57 tests stayed green; new test `tests/orchestrator/resume-skip-stages.test.js` pins the contract.

### KJC-BUG-0060 — `autoInit()` committed empty commits on user's main (PR #797)

Reported during the v2.19.3 release itself: after `git checkout main`, `git status` showed `[ahead 27]` of origin/main. Every one of the 27 commits was titled `initial commit`, authored by the karajan-code-local `user.email` (which diverges from the global one), and pointed to **the exact same tree as its parent** — completely empty. The reflog held **2 495 such SHAs** accumulated since April 2026. None had ever reached origin/main (the push or CI would have rejected them) so runtime impact was zero, but on every release the local history looked like a sync loss.

Root cause: `src/orchestrator/config-init.js::autoInit()` guarded with `!(await exists(projectDir/.git))`, which fails two ways.

1. **Dogfooding kj on karajan-code itself** (kj-linked points to the source tree). When `kj run` was invoked from any subdirectory of the repo, `initFlowContext` (drivers/init-context.js:42) passed that subdir as `projectDir`. The subdir had no `.git/` of its own → `exists()` returned false → the subsequent `git init` reinitialized the *parent's* `.git/` (idempotent, harmless), and the `git commit --allow-empty` resolved upward to the parent repo and landed an empty commit on `main`.
2. **Transient FS hicks.** EACCES / ENOENT during a concurrent `.karajan/` scan would flip `exists()` to a false negative and trigger the same code path.

Fix: switch the static FS probe for git's own upward-traversal check.

```js
try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectDir, stdio: "pipe" });
  // already inside a work tree — own or parent's — bail out
} catch {
  execFileSync("git", ["init"], { cwd: projectDir, stdio: "pipe" });
  // NO `git commit --allow-empty` anymore
}
```

Two changes in one fix.

1. `rev-parse --is-inside-work-tree` performs the same upward search that git would use for the commit itself — the guard cannot disagree with the operation it guards. False-positive FS probes are irrelevant; if git says we're inside a work tree, no commit will land in the wrong place either way.
2. The seed empty commit is dropped. No downstream stage (diff, review, coder, sonar) needs a root commit; the 2 495 zombies never broke anything. The empty seed was decorative and turned out to be the actual user-visible symptom.

LOC budget: +117 / -9, net +108. Inside 200 hard / 150 ideal. 9 orchestrator test files / 54 tests stayed green; new test `tests/orchestrator/config-init-autoinit.test.js` pins the three acceptance scenarios (subdir of repo, clean dir, own repo).

## Phase 76: HU Board polish + UX papercuts cluster (v2.20.0)

**v2.20.0** (minor, 2026-05-24) — five cards in the HU Board polish cluster: two net-new features (`PREFLIGHT-000` HU auto-inject + `kj init` scope wizard), two PG housekeeping syncs for work that had already landed (Stop button + auto-cleanup ampliado), one docs refresh.

The unifying theme: **stop making the user remember Karajan's plumbing**. Every card here moves a responsibility that was sitting on the user's mental stack into Karajan itself. Don't make the user add a `Verify env` step to every task.md — inject it. Don't make the user edit YAML to switch coder providers per project — give them a scope flag. Don't make the user kill PIDs by hand from a terminal when the board could do it. Don't make them rediscover SPEC conventions by dogfooding — document them.

### KJC-TSK-0397 — `[PREFLIGHT-000]` HU auto-inject (PR #801)

Every `kj plan generate` now ends with a `prependPreflightHu(plan, projectDir)` call that mutates the plan in place before `savePlan`. The new HU sits at `plan.hus[0]` with id `PREFLIGHT-000`, task_type `infra`, blocked_by `[]`. Every other HU gets `PREFLIGHT-000` appended to its `blocked_by` (idempotent — already-present ids are not duplicated). The HU's `acceptance_tests` are pure shell, stack-aware:

- Always: `git status --porcelain | (! grep -q .)` — the working tree must be clean.
- Node / TypeScript: `node --version` matches `v2[0-9]` or higher; `npm install --no-audit --no-fund`; conditional `npm test` and `npm run lint` only if those scripts exist.
- Python: `python --version` matches `Python 3.(1[0-9]|[2-9][0-9])`; `pip install -r requirements.txt` when present or `poetry install` / `pip install -e .` for pyproject; `pytest --collect-only || true` so the collect phase doesn't gate on a freshly-init'd repo with no tests yet.
- Firebase project (detected by `firebase.json`): `firebase projects:list`.
- GCP project (detected by `.gcloudignore`): `gcloud auth list --filter=status:ACTIVE` non-empty.

The idempotence is a contract, not a nicety. The same plan flows through structural-pass + plan-fixer + spec-reviewer before `savePlan`, and any of those can pass it through `prependPreflightHu` more than once. Same for users who manually declare `[PREFLIGHT-000]` in their task.md — `hasPreflightHu(plan)` does a conservative pattern match on id and on title substrings (`preflight-000`, `verificar entorno`, `preflight check`) so the user's own HU is respected.

The flag `--no-preflight-hu` opts out per invocation. The flag default is "on" — the *feature* default is preflight gating. Six CI tests + four e2e tests that pre-dated the feature were updated to pass `--no-preflight-hu` (they assert on plan shapes that don't include `PREFLIGHT-000`); the new contract has its own 6 acceptance tests in `tests/plan/preflight-hu.test.js`.

LOC: +197 / -4 (preflight-hu.js 102 lines + test 84 lines + glue elsewhere), net +197 — just under the 200 hard limit.

### KJC-TSK-0395 — `kj init` scope wizard + `--global` / `--local` (PR #802)

Until v2.20.0, `kj init` always wrote to `~/.karajan/kj.config.yml`. There was no scope concept at the CLI level even though `loadConfig` had honoured `<project>/.karajan/kj.config.yml` as an override layer for a while. Result: power users who wanted `coder=claude` for one repo and `coder=opencode` for another had to edit YAML by hand.

`resolveConfigScope({ flags, interactive })` resolves the destination path: `--global` → `getConfigPath()`; `--local` → `getProjectConfigPath(process.cwd())`; both → throw `Cannot pass both --global and --local`; interactive + no flags → `wizard.select(...)` with both options described in human text; non-interactive + no flags → global (legacy CI default). The function is exported so unit tests can drive it without spinning up the rest of `initCommand`.

The interesting half is in `loadConfig`. Before v2.20.0, a project config without a global counterpart silently behaved like a global config — but without the merged defaults (`DEFAULTS < global < project`), so several fields the user expected to inherit from the global baseline came out as `undefined`. Almost always a copy-paste error (the user dragged a `.karajan/` dir from another repo). The new `loadConfig` refuses with an actionable message pointing at `kj init --global` first.

That one fix turns the implicit "you can technically do this but it'll break" into the explicit "you can't do this; here's what to do instead". The fix surfaces the mistake at the first `kj` invocation instead of waiting until the third command burns tokens against a half-resolved config.

LOC: +120 / -5, net +115. Inside 200/150. Five new acceptance tests in `tests/commands/init-scope.test.js`; existing `tests/init-wizard.test.js` needed three lines updated (mock now exports `getProjectConfigPath`, mockResolvedValueOnce queue prepends `global`, expected select count 15 → 16).

### KJC-TSK-0396 (PG sync) — HU Board `⏹ Stop` button

The button itself was first shipped in v2.10.x (PRs #702 + #703). What today's release adds is closure of the PG card with the canonical commits as evidence. The wiring deserves recording here because it's the only board endpoint that crosses the process boundary:

- Frontend: when at least one HU is in `coding`/`reviewing`, the section header renders a red ⏹ Stop button next to the running badge. Click → `showConfirm` (destructive style) → `POST /api/runs/:planId/stop` per unique `plan_id` in the running set → `POST /api/sync` → re-render. The button uses the same delegate-on-document pattern as the ▶ Run button, with `data-plan-id` + `data-pids` so a HU-launched run and a plan-launched run both surface the same way.
- Backend: `/runs/:planId/stop` queries `getActiveRuns(planId)` (cross-process registry persisted under `~/.karajan/hu-board-runs/`), sends `SIGTERM` to every tracked PID, sleeps `req.body.timeoutMs ?? 5000` ms, sends `SIGKILL` to any still alive. Then UNCONDITIONALLY resets `stories.status` from `coding|reviewing|running` to `pending` for that `plan_id` so a manually-killed run (Ctrl+C in the launching terminal) still leaves the board in a consistent state. Response shape: `{ stopped, killed, errors, hu_reset_count }`.
- Cross-process registry: `packages/hu-board/src/run-tracker.js` persists `{ pid, planId, startedAt }` so the board's Stop button can kill runs the user launched in their terminal (and vice versa, future work).

### KJC-TSK-0377 (PG sync) — auto-cleanup ampliado

`packages/hu-board/src/ephemeral-cleaner.js` originally targeted four prefixes: `tmp_*`, `test_*`, `demo_*`, `kj-test-*`. PR #683 (v2.12.x) added `auto-tmp_*`, `auto-test_*` (covering auto-batch projects), `s_*` (stray session-id placeholders created by sync handlers when a `kj run` lands without a `projectDir`), and `plan-*` (the same case for plan-id placeholders). Plus `is_test = 2` semantics: 1 means "user marked as ephemeral", 2 means "user explicitly marked as keep", null means "fall back to prefix detection".

The architectural value of this card is the **exemption hierarchy**: prefix detection is the default rule, but `is_test = 1/2` is a per-row override. That keeps the cleaner from getting in the way of users who deliberately have a `test_<project>` repo they want to keep.

### KJC-TSK-0385 — docs/task-templates/spec-conventions.md refresh (PR #800)

Two sections added documenting what was previously implicit in the planner prompt:

- **Section 8** — Numbered headings in a task file (`## 1.`, `### 2.1`, `§5`) activate the `spec_section` REQUIRED field on every emitted step. The activation is detected by `detectSpecSections(task)`; once it fires, the planner refuses to leave `spec_section` null. Users were seeing 'missing spec_section' findings without understanding the activation rule.
- **Section 9** — Every step ships with 2-4 `acceptance_tests`, mix of `gherkin` (observable behaviour) and `shell` (concrete commands exit 0 on success), pre-implementation, no `npx vitest run` placeholder. The planner composes them; the sub-pipeline runs the shell ones after each coder iteration. The gap was between "I see acceptance_tests in my plan" and "I understand what they are for".

Plus a `~/.kj/plans/` → `~/.karajan/plans/` path fix in two places in `plan-generate.md` (post-v2.19.0 home consolidation).

## Phase 78: Brownfield Onboarder role (v2.21.0)

**v2.21.0** (minor, 2026-05-24) — closes KJC-TSK-0384 in three PRs. The Onboarder is the bridge between an *existing* codebase and Karajan's pipeline: it digests what the project already is so the planner / researcher / coder can write tasks that fit, rather than writing tasks the project was never built to absorb.

The architectural seam this opens matters more than the immediate UX win. Onboarder is the **prerequisite for the Project RAG epic** (KJC-PCS-0049, starting v2.22.0). RAG needs a per-project signal of "what lives where" before it can index intelligently; the Architecture Brief is that signal in its first form, machine-readable enough for the indexer to seed itself.

### PR 1 — deterministic collectors

`src/onboarder/collectors/index.js` exposes five pure, JSON-serialisable, fail-soft extractors. The contract: take a `projectDir`, return a JSON value. No exceptions across the public surface — every collector catches its own I/O failures and returns `null` / `[]` for the slot, so `collectAll`'s `Promise.all` never partial-fails. This is the same discipline as the preflight HU's `composePreflightTests` (KJC-TSK-0397): the synthesis step downstream should be able to assume the bundle is structurally valid even when half the project is missing.

| Collector | Returns | Failure mode |
|---|---|---|
| `collectTree(projectDir, { maxDepth = 2 })` | `[{ path, kind, bytes, children? }]` ignoring `node_modules` / `.git` / `dist` / etc. | Unreadable subdir → skipped, walk continues |
| `collectGitHistory(projectDir, { maxHotFiles = 10 })` | `{ commitCount, branches, hotFiles, headSha }` or `null` on non-git | Whole result is `null` on greenfield |
| `collectConfigs(projectDir)` | `{ present: string[], scripts: object? }` | Missing package.json → `scripts: null`, other configs left out of `present` |
| `collectAdrs(projectDir)` | Relative paths matching `adr-N`, `NNNN-*.md`, `architecture*.md` under `docs/adr*` and `docs/architecture/` | `[]` when nothing matches |
| `collectAll(projectDir)` | Bundle wrapping every collector + a `collectedAt` ISO timestamp | Independent slots; nothing aborts |

The hot files heuristic is deliberately cheap: top N by appearance count in `git log --name-only --pretty=format: -n 200`. Not the most refined signal — a recent megacommit can skew it — but good enough for the synthesis step to ask "where does work happen here?" without a second LLM round-trip.

### PR 2 — OnboarderRole + `kj onboard` command

`src/roles/onboarder-role.js` is the thinnest `AgentRole` subclass in the codebase. It defers the prompt itself to `templates/roles/onboarder.md` (which lives in the AI-rule files cohort and counts against LOC budget per the two-cohort rule). The role's parser unwraps a fenced markdown block if the agent emitted one, otherwise trims the raw output; `handleParseNull` returns a soft-success with whatever raw output existed, so a greenfield project never propagates an error upstream.

`src/commands/onboard.js` orchestrates the pipeline:

```text
collectAll(projectDir)
  → if flags.noSynth: write raw bundle inside JSON fence, done.
  → else: OnboarderRole.run({ bundle }) → write parsed Markdown brief.
```

The output target is `~/.karajan/onboarding/<slug>.md` where `<slug>` is a sanitised basename of `projectDir`. The function `briefPath(projectDir)` is exported precisely because PR 3 needs the same slug rule to read the cache deterministically — writer and reader share one source of truth.

The `--no-synth` flag deserves its own paragraph. It dumps the raw collectors bundle without invoking any LLM, useful for two contexts: CI runs that want the structural snapshot without paying the synthesis cost, and any consumer that prefers to read the JSON directly (a future RAG indexer, for instance).

### PR 3 — `kj plan generate --use-onboarding`

The smallest of the three PRs (net +84 LOC) but the one that closes the loop. `src/onboarder/cache.js::readCachedBrief(projectDir)` returns `{ found, path, content? }`, never throws. `kj plan generate` reads the brief when the flag is set and prepends it to the planner context under a `## Architecture Brief (from kj onboard)` heading. The prepend composes — any explicit `--context` the user passes stays in place, just below the brief.

The error semantics are intentional. Without the flag → no cache read, no log line. With the flag and a missed cache → `warn` log so the user notices the missed `kj onboard` invocation; planning proceeds anyway without the brief. With the flag and a present cache → the brief flows through, a `runLog` line records the injection path. Loud where it matters; silent where it doesn't.

The new `useOnboarding` flag is forwarded through the explicit whitelist in `src/cli/register-plan.js`, mirroring the lesson learned from KJC-TSK-0397: a flag dropped from the whitelist surfaces as "the feature doesn't work" with zero error — never trust the implicit forward.

### What's next

The **Project RAG** epic (KJC-PCS-0049) opens in v2.22.0. Eight PRs planned:

1. Vector store on `better-sqlite3` + `sqlite-vec` (`~/.karajan/rag.db`).
2. Embedder adapter for the existing local Ollama endpoint (`nomic-embed-text` or `mxbai-embed-large`).
3. Chunker (markdown semantic for plans, AST-aware for code).
4. Indexer (chokidar watcher over `~/.karajan/plans/` + `projectDir`).
5. Retriever + ranking.
6. CLI: `kj rag <query> [--scope plans|code|all]` + `kj rag index --project <id>`.
7. MCP tool: `kj_rag_query` for other agents.
8. HU Board search panel.

The Onboarder's `onboarding/<slug>.md` is the seed signal for the indexer's first pass — it already knows what the project IS, so the indexer can pick chunking strategies (per-language) and weights (hot files first) without re-scanning.

## Phase 79: Project RAG epic shipped end-to-end (v2.22.0 → v2.25.0)

What in Phase 78 was a single sentence about the next epic landed across four consecutive minor releases. The pattern was unusual: the same epic (KJC-PCS-0049) was structured deliberately as a sequence of small minors instead of a single big bump, so each layer of integration could be released, dogfooded, and refined before the next went out.

**v2.22.0 — CLI MVP** (6 PRs, steps 1-6). Five neutral modules under `src/rag/`: `vec-store.js` (sqlite-vec init, BigInt rowid handling), `embedder.js` (Ollama adapter with `OllamaEmbedderError`), `chunker.js` (markdown + plan + source variants sharing a `windowText` splitter), `indexer.js` (idempotent file indexing + project pass), `retriever.js` (cosine over `topK*2`, kind boost: plan +0.05, onboarding +0.03, code 0). Plus `src/commands/rag.js` with `kj rag index [--with-sources]` and `kj rag query <text> [--scope] [--top-k] [--json]`. SEA build broke first on the native deps (better-sqlite3, sqlite-vec); `ragStubPlugin` added to `scripts/esbuild-sea.config.mjs` solved it by intercepting `/rag/` and `commands/rag.js` paths at build time so binary builds skip native compilation. `~/.karajan/rag.db` is the default store; `KJ_RAG_DB` overrides.

**v2.23.0 — three more consumer surfaces** (3 PRs, Steps 7-8 + Camino A). MCP gets `kj_rag_query` + `kj_rag_index` (`src/mcp/handlers/rag-handler.js`, tool count 25 → 27); HU Board gets a search panel between the preflight pane and the kanban (`POST /api/rag/query` + frontend rag-panel); role templates (`templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md`) each gain a 'Prior context (RAG, opt-in)' section calibrated per role — coder/architect/spec-reviewer at `topK:3, scope:'all'`, researcher/planner at `topK:5, scope:'plans'`. Shared rule across all roles: when the store responds `empty:true`, proceed without retrieval, do NOT block, do NOT ask a human to seed. Layer boundary established: `src/mcp/handlers/rag-handler.js` cannot import from `src/commands/rag.js` (peer layers); both consume `src/rag/*` as neutral.

**v2.24.0 — Camino C: pre-loop auto-retrieval**. `runRagContextStage` (`src/orchestrator/stages/rag-context-stage.js`) runs between triage and domainCurator. The architectural move that made this 9 LOC instead of a refactor across every role: because `task` is a plain string parameter that flows through `runPlanningPhases` to researcher/architect/planner via parameter passing, **one mutation in the pre-loop driver feeds six downstream consumers** with zero per-stage code change. Five guards prevent the stage from ever throwing — `disabled`, `no-task`, `empty`, `no-hits`, `error` — and only one is a hint to the human (`empty` → "run kj rag index to seed"). Static imports (not dynamic) keep the dynamic-imports budget headroom intact; the SEA stub plugin handles them transparently at build time.

**v2.25.0 — Camino B + Camino D: the consumer-surface plan closes**. Camino B is `templates/skills/kj-rag-query.md`, shipped by `kj init` to `.claude/commands/` so Skills hosts without MCP reach RAG through `/kj-rag-query <text>`. Thin wrapper over the CLI: passthrough flags, render hits as background context rather than raw JSON, surface `empty:true` as a one-line hint that does not block the conversation. Camino D is `src/orchestrator/stages/rag-preload-decisor.js` — a pure `shouldPreloadRag({triage, task, config})` heuristic wired in `pre-loop.js` before `runRagContextStage`. New `config.rag.preload.policy`: `always` (v2.24.0 default behaviour, kept for back-compat), `never` (benchmarking), `auto` (new default). In `auto` mode, retrieval fires when triage decomposes, level ∈ {complex, high, epic}, task body ≥ 200 chars, or `config.rag.preload.brownfield` is set; otherwise the stage persists `{ skipped: true, reason: 'auto:low-value' }` so resume + audit see why retrieval was skipped on every session.

**What changed in the way Karajan thinks about agents**. Before v2.22.0 each agent role assumed it was working from cold context — task text + role prompt + whatever the host's working memory happened to contain. After v2.25.0 every role has an opt-in path to prior context that does NOT pollute the role prompts (Camino A is per-role, calibrated; Camino C is one-shot, transparent; Camino B is human-driven; Camino D refines cost). Four entry points covering MCP, Skills, automatic injection, and explicit query — none of them coupled to a specific host, and all of them sharing the same `src/rag/*` neutral layer underneath.

## Phase 80: RAG Auto-Bootstrap — Ollama in Docker out of the box (v2.26.0)

Phase 79 closed the consumer-surface plan: RAG was reachable from CLI, MCP, Board, role instructions, pre-loop and slash command. But dogfooding v2.25.0 surfaced a structural problem nobody had questioned: the feature only worked if the user had **already installed Ollama on the host**. The dependency was invisible — none of the install paths mentioned it, and the failure when Ollama was absent looked like a Karajan bug.

Phase 80 makes the embedder a first-class part of the Karajan installation, exactly like SonarQube was made first-class in v2.7. Three PRs that mirror the sonar pattern down to the file layout:

**KJC-TSK-0435 — `src/rag/ollama-manager.js` (PR #825)**. Side-by-side parity with `src/sonar/manager.js`: `normalizeOllamaConfig`, `buildComposeTemplate`, `ensureComposeFile`, `isOllamaReachable`, `findAvailableOllamaPort`, `waitForOllamaReady`, `ollamaUp` / `ollamaDown`. `ollamaUp` short-circuits when the host port already responds to `/api/tags` (returns `reusedHost` so the caller wires the existing instance into config instead of spawning a duplicate). When `external: true` and unreachable, refuses — the user has opted out of Karajan managing the container, so Karajan does not silently spawn one. Compose written to `~/.karajan/docker-compose.ollama.yml`.

**KJC-TSK-0436 — Capability + auto-pull + `kj init` (PR #828)**. `src/rag/ollama-capability.js` exposes `checkDockerAvailable` (`docker --version` then `docker info`) and `checkRamCapacity` (`os.freemem()` >= 4 GB default). Aggregated as `checkOllamaCapability()` returning `{ capable, reasons[], docker, ram }`. `kj init` runs `bootstrapOllama()` between `installSkills` and the stack detection step. Capability fails → warn with the explicit reason and continue (init never crashes on the user). Capable → `ollamaUp()` → `waitForOllamaReady()` → `docker exec kj-ollama ollama pull nomic-embed-text`.

**KJC-TSK-0437 — `kj doctor` + `kj ollama` (PR #827)**. `src/checks/ollama.js` plugs into `buildChecks()` next to `getSonarChecks()`. When `rag.preload.enabled !== true` the check reports `info: Disabled in config` — quiet on greenfield projects that never opted in. Otherwise it pings `/api/tags` and reports `ok` / `warn` with fix hint pointing at `kj ollama start`. The new `kj ollama [start|stop|status|pull <model>]` subcommand wraps the manager and capability layers so the user manages lifecycle without touching docker compose.

**Bug fix bundled — KJC-BUG-0061 (PR #824)**. The smoke test that drove Phase 80 also caught three latent bugs spread across v2.21.0 → v2.25.0: `kj onboard --no-synth` was silently ignored because Commander maps `--no-synth` to `flags.synth=false`; the synth branch invoked `OnboarderRole.run()` without `init()`; and `kj rag query --json` on an empty store emitted just `[]` instead of `{ hits: [], empty: true, topK, scope }`, breaking the Skills-mode contract the `/kj-rag-query` wrapper promised. All three fixed and shipped between v2.25.0 and v2.26.0.

**What changes for new users**. Before v2.26.0: install Karajan → install Ollama manually → pull the model manually → wire `rag.embedder.url` → run. After v2.26.0: install Karajan → `kj init` does all of the above and tells you whether it worked. Three less things to get wrong, three less reasons to bounce off the product. **Coming in v2.27.0+**: chokidar watcher, AST source chunker, BM25 + cosine hybrid, OpenAI/Voyage adapters.

## Phase 81: RAG quality lift — dashboard, three providers, metadata filter, rerank (v2.29.0)

Phase 80 made the embedder a first-class install citizen; Phase 81 makes the retriever's *output* observable and tunable. Five PRs land in a single minor, all aimed at the gap between "RAG works" and "RAG works well for *this* query in *this* project".

**KJC-TSK-0445 — Retrieval-quality dashboard on the HU Board (PR #843)**. New standalone page `/rag.html` served by the existing HU Board. Backend `GET /api/rag/stats` opens the local `rag.db` read-only and returns a snapshot: total chunks, DB size on disk, last-index timestamp, chunks grouped by kind (`code / plan / onboarding`), and chunks grouped by project slug (top 20). The active embedder is read from `kj.config.yml`. Missing DB returns `{ initialized: false, message }` so the page renders an empty state instead of crashing. Frontend has zero charting deps — bar charts are plain `<div>` + CSS. This is the bridge to Phase 82's writable config UI: visibility first, controls second.

**KJC-TSK-0446 — Cohere + Mistral embedder adapters (PR #848)**. Two more cloud providers that share the existing `_cloud-base.js` Bearer-auth helper: `embed-multilingual-v3.0` (1024 dim) for strong multilingual retrieval, `mistral-embed` (1024 dim) for EU-hosted users with GDPR constraints. `KJ_COHERE_KEY` / `KJ_MISTRAL_KEY` Karajan-scoped env vars — the architecture invariant that Karajan never reads provider-named API keys (`COHERE_API_KEY`, `MISTRAL_API_KEY`) directly stays intact. The v2.28 roadmap's "Anthropic via OAuth" slot is dropped because Anthropic has no embeddings endpoint; Cohere + Mistral cover that need with first-party services.

**KJC-TSK-0447 — ONNX local embedder (PR #850)**. Sixth provider — and the first fully local one outside Ollama. `src/rag/embedders/onnx.js` wraps `@huggingface/transformers` (with `@xenova/transformers` as legacy fallback) and runs sentence-transformer models directly in Node. Default `Xenova/all-MiniLM-L6-v2` (384 dim, ~80 MB cached on first use); high-quality alternative `Xenova/jina-embeddings-v2-base-en` (768 dim). Both transformers packages are **optional peer deps**, not auto-installed — combined ~500 MB with WASM and ONNX runtime, too heavy to impose on users who never opt into `provider: onnx`. The adapter throws an actionable install hint when missing. This unlocks Phase 83 (zero-config init): a sensible default that needs **zero** infrastructure.

**KJC-TSK-0448 — Metadata `--where` filter (PR #??)**. The retriever now accepts per-chunk metadata constraints with a minimal `KEY=VALUE AND KEY=VALUE` grammar. `kind` filters the column directly; every other key routes through SQLite `json_extract(c.metadata, '$.<key>') = ?`, so anything the chunker already emits (`symbol`, `hu_id`, `headingPath`, `file`, …) is queryable without schema changes. The filter applies uniformly to both semantic and BM25 sides of the hybrid retriever, so score fusion still works. Quoted-string values for spaces; rejection of malformed input with explicit error.

**KJC-TSK-0449 — Cross-encoder rerank (PR #??)**. Opt-in `--rerank` flag that re-scores the topK survivors with a (query, passage) cross-encoder model — `Xenova/ms-marco-MiniLM-L-6-v2` by default. Cross-encoders are slower than bi-encoders (they jointly encode the pair instead of caching the passage embedding), so the reranker is invoked only on the post-fusion, post-boost candidates and never on the full corpus. Plugs in after the kind+source boosts as a finer-grained quality lever, not a replacement.

**What changes for users**. Before v2.29.0: "is RAG indexing my repo?" had no answer outside the CLI. Cloud options were OpenAI / Voyage; running RAG without any cloud or Docker required Ollama. Queries with metadata constraints needed client-side filtering. Ranking quality was capped by the hybrid retriever's score fusion. After v2.29.0: dashboard answers the visibility question in one click; ONNX answers "I want RAG with zero infra"; `--where` answers "find the chunk where `symbol=loadConfig`"; `--rerank` answers "I want the best possible ranking and I'll pay for it". **Coming in v2.30.0+**: writable config UI on the HU Board (toggle roles, swap embedder, adjust alpha/mode/rerank without re-editing the YAML), then v2.31 zero-config init (wizard reduced to one critical question, smart defaults everywhere else).

## Phase 82: Writable config UI on the HU Board (v2.30.0)

Phase 81 made the retriever observable; Phase 82 makes the entire config **editable from the board**. Four PRs land the settings modal end-to-end, closing the v2.29.0 teasers (toggle roles, swap embedder, adjust alpha/mode/rerank without re-editing the YAML) into a real surface.

**KJC-TSK-0450 — Pipeline role toggles (PR #854)**. The settings modal grows a "Pipeline roles" section where every optional role (researcher, architect, refactorer, security, audit, rag-context) is a checkbox. Backend uses a strict whitelist in `packages/hu-board/src/config-yaml.js` (`EDITABLE_FIELDS`) and atomic writes (write to `.tmp`, `rename`, keep `.bak`) — the user's YAML structure is preserved, no reformatting, no comment loss. Anything not on the whitelist returns 400.

**KJC-TSK-0451 — RAG controls (PR #855)**. Sliders + selects for `rag.search.{mode,alpha,rerank}`: `mode ∈ {hybrid, semantic, bm25}`, `alpha ∈ [0, 1]` (semantic vs lexical weight in hybrid), `rerank` toggle. The modal shows a live preview of the payload before submitting, so the user sees exactly what writes to disk.

**KJC-TSK-0452 — Grouped sections in the config modal (PR #856)**. Visual reorg: Pipeline / RAG / Coder / Reviewer / Brain in collapsible blocks. Cuts the scroll and makes the modal usable as the config surface grows — without it, v2.30 would feel like a wall of fields.

**KJC-TSK-0453 — Scope toggle (PR #857)**. The big one: every section now has a "Scope: global / project" switch deciding where the write lands. `'global'` → `~/.karajan/kj.config.yml`; `'project'` → `<projectDir>/.karajan/kj.config.yml`. The `projectDir` resolves the same way as the journal-parser (`process.env.KJ_PROJECT_DIR || process.cwd()`). When both files exist, the project-level config wins — matching Karajan's CLI precedence rules.

**What changes for users**. Before v2.30.0: changing a role toggle or an embedder meant opening the YAML manually, hoping not to break the indentation. After v2.30.0: open the board, click settings, flip the toggle, pick the scope. The atomic write + `.bak` makes it safe; the whitelist makes it sandboxed. **Coming in v2.31.0+**: zero-config init wizard reduced to one critical question with smart defaults — now that the config is editable from the board, init can ship a minimal `~/.karajan/kj.config.yml` and let the user fill in the rest visually instead of via prompts.

## Phase 83: Team-shared HU Board (v2.31.0)

Phase 82 closed the per-machine editing story; Phase 83 closes the **multi-machine** story. The HU Board now models a cohort: a plan can live in `~/.karajan/plans/<planId>/` (local-only) or in `.karajan-shared/plans/<planId>/` (shared across every machine running Karajan on the same project). Seven PRs (#859–#865) land the workflow end-to-end and close the long-standing prerequisite KJC-PRP-0002.

**KJC-TSK-0456 / KJC-TSK-0457 — Loader merge + scanner badge (PR #859 / PR #860)**. `loadPlan()` reads both the local plan and the shared cohort and merges HUs by `id`. The board scanner does a sibling scan on `.karajan-shared/`, stamps `is_shared = 1` on every chunk it pulls from there, and the `/api/plans/:id/hus` response exposes a `shared` boolean. The frontend renders a `shared` badge next to the HU id — the cohort membership is visible without having to open the plan file.

**KJC-TSK-0458 — `kj plan share <planId>` CLI (PR #861)**. New command. Copies the plan dir from `~/.karajan/plans/` to `<projectDir>/.karajan-shared/plans/` atomically (write to `.tmp`, `rename`). Refuses to overwrite an existing shared plan unless `--force`. Default behaviour shares the whole plan; the optional `--only id1,id2` / `--exclude id3,id4` filters land in PR4.

**KJC-TSK-0459 — `kj plan unshare` + `shared` badge wiring (PR #862)**. `kj plan unshare <planId>` removes the shared copy; the local copy stays untouched. The board badge now follows the cohort live — unshare a plan and the badge disappears on the next scan without restarting the server. A new `projectIsSharedCache` memoizes the per-project shared-or-not lookup so the UI doesn't hammer the API on every HU row render.

**KJC-TSK-0460 — `--only` / `--exclude` filters (PR #863)**. The share command grows selective filtering. `--only` accepts a comma-separated list of HU ids; only those are copied to the cohort. `--exclude` is the inverse. Mutually exclusive, with validation that every named id exists in the plan. Lets a runner share *parts* of a plan while keeping the rest local.

**KJC-TSK-0461 — `sharedConflictPolicy` config (PR #864)**. When the same HU id exists in both the local and the shared cohort (concurrent edits across machines), `sharedConflictPolicy` decides what `loadPlan()` does: `'local-wins'` (default, fast path), `'shared-wins'` (cohort is the source of truth), or `'error'` (refuse to load, force human resolution). Configurable in `kj.config.yml` under `huBoard.sharedConflictPolicy`.

**KJC-TSK-0462 — HU `assignee` field (PR #865)**. New whitelisted field on `EDITABLE_HU_FIELDS`. Free-form string (a name, a machine id, an email) so two runners working on the same cohort can claim their slice. Persists via the same atomic-write path as the other editable HU fields.

**What this unlocks**. v2.31.0 closes the team-shared HU Board prerequisite (KJC-PRP-0002) — the last roadmap item before the v3.0 Brain rewrite can rely on a stable multi-runner substrate. Multiple machines can now share a plan, see each other's progress on the same board, and claim non-overlapping work via `assignee`, without trampling each other.

## Phase 84: AI Harness Scorecard hardening (v2.32.0)

Phase 83 closed the multi-runner substrate; Phase 84 closes the **engineering rigor** gap. KJC-PCS-0051 ("AI Harness Scorecard hardening") runs the dogfood suite against the same internal scorecard Karajan uses on customer projects — five FAILs on a "Plan A" punch list (formatter gate, coverage reporters, commit lint, nightly drift detector, security linter) plus two collateral bug fixes. All five quick-wins ship in v2.32.0.

**KJC-TSK-0464 — Prettier `--check` CI job (PR #868)**. The repo had `prettier` in dev deps but no CI gate enforcing the format. Phase 84 adds a curated-scope `prettier --check` job to `.github/workflows/quality.yml` that fails the build on any unformatted file under `src/`, `tests/`, `packages/`, `scripts/` (excluding the snapshot/fixture directories). Catches drift at PR time, not at release time.

**KJC-TSK-0465 — Coverage v8 + artifact upload (PR #870)**. The Vitest config grows a `@vitest/coverage-v8` reporter trio: `text` (console summary on every `npm test`), `html` (drill-down report under `coverage/`), `lcov` (machine-readable, picked up by CI). The CI job uploads the `coverage/` directory as a GitHub Actions artifact retained 7 days, so every PR carries a downloadable coverage report. Per-package threshold ratchet stays opt-in — the artifact is the ground truth, not a hard gate.

**KJC-TSK-0466 — `commitlint` GitHub Action (PR #872)**. `wagoid/commitlint-github-action@v6` runs on every PR and re-runs the same Conventional Commits rules the local pre-commit hook enforces. The CLI hook is easy to skip with `--no-verify`; the CI gate is not. The Action reads `commitlint.config.mjs` from the repo root, so no rule duplication.

**KJC-TSK-0467 — Nightly drift detector (PR #873)**. New scheduled workflow `.github/workflows/nightly-drift.yml` runs at 03:00 UTC against `main`, executes `npm outdated --json` + `npm audit --json --omit=dev`, and posts a comment to a tracking issue when either surface changes. Uses `actions/github-script@v8` (the v7 syntax was deprecated upstream). The issue stays open as a rolling log — drift is visible without polluting the PR queue.

**KJC-TSK-0468 — `eslint-plugin-security` (PR #874)**. Adds `eslint-plugin-security@4.0.0` with a curated rule set in `eslint.config.js`: `detect-eval-with-expression`, `detect-non-literal-require`, `detect-unsafe-regex`, `detect-buffer-noassert`, `detect-child-process`, `detect-pseudoRandomBytes`. The full plugin would have lit up hundreds of false positives; the curated subset stays useful. Net new findings: 14 `detect-non-literal-regexp` warnings tracked as follow-up, none on the security-critical paths.

**KJC-BUG-0065 / KJC-BUG-0066 (PR #869 / PR #871)**. The two collateral fixes. BUG-0065 repaired 42 tests that had been failing on `main` after a refactor of the journal stage helpers — the tests targeted the old signature and were caught by the coverage v8 baseline run for TSK-0465. BUG-0066 fixed a missing `await` on `openEditor` in the spec-review refine loop — without it the editor process disowned and the loop continued before the user could save, eating the refined spec.

**What changes for engineers**. Before v2.32.0: the project's own CI was *softer* than the gates Karajan applied to user projects via `kj audit` — formatter unchecked, commit messages enforced only locally, no nightly visibility on dep drift, security linting on the roadmap. After v2.32.0: the same scorecard Karajan grades you on, Karajan now grades itself on. The next FAILs on the punch list (climbing `src/mcp/handlers/**` coverage back to 80/80, resolving the 14 `detect-non-literal-regexp` warnings) are tracked as standalone tasks, not release blockers.

## Phase 85: AI Harness Scorecard golden metric (v2.33.0)

Phase 84 closed the FAILs the external scorecard flagged on Karajan; Phase 85 closes the loop the other way — **the scorecard becomes a first-class signal inside Karajan's own audit**. KJC-PCS-0051 Plan B turns `kj audit` into a continuous quality-measurement loop with a single golden number and an A–F grade, persisted per project, with zero LLM tokens spent on the metric itself. Four PRs (#877–#880), all under the shrink-budget cap.

**KJC-TSK-0470 — Docker bootstrap of `ai-harness-scorecard` (PR #877)**. `kj audit` now auto-pulls `addyosmani/ai-harness-scorecard` on first use and runs a one-shot scan against the current working directory. The bootstrap reuses the same default-on-with-`--no-*` opt-out pattern established by the Ollama auto-bootstrap in v2.26.0 — install nothing, ship nothing manual; the only requirement is a running Docker daemon. `--no-harness` opts out for air-gapped environments. Warm runtime ~10 s; pull-on-first-run ~30 s once and never again.

**KJC-TSK-0471 — Audit report integration (PR #878)**. The harness output (a deterministic 0–100 score plus an A–F grade plus per-check booleans) splices into the audit report headline alongside the deterministic finding tally. CLI/MCP parity preserved; the JSON payload exposes `harness.score`, `harness.grade`, `harness.checks[]` so downstream tooling (HU Board panels, custom dashboards) can read the metric without re-running the scan. The harness section sits ABOVE the LLM-driven findings — it's the first thing the user sees because it's the cheapest and most trustworthy signal.

**KJC-TSK-0472 — Per-project history DB (PR #879)**. Every audit run persists to `.karajan/audit-history.db` — a per-project SQLite store, WAL-mode for concurrent reads during a run, `PRAGMA user_version=1` for versioned migrations. The schema captures `run_id`, `started_at`, `score`, `grade`, `checks_json`, `commit_sha`. Per-project (not global): the DB lives inside the repo's `.karajan/` so each codebase carries its own grading history; it's gitignored by default. Versioned migrations mean future schema changes (adding `branch`, `harness_image_sha`, …) ratchet forward without breaking old runs.

**KJC-TSK-0473 — Diff vs baseline + trend sparkline (PR #880)**. The audit report now shows the delta vs the previous baseline (`Δ +7 vs run #12 from 2026-05-21`) and an optional Unicode-bar trend sparkline (`▁▂▃▄▅▆▇█`) over the last N runs. Edge cases enumerated in 12 unit tests (`tests/audit/audit-history-display.test.js`): first run (no diff line at all), stale baseline (>30 days old → warning marker), biggest delta in window (highlighted), missing commit SHA (fallback to run number), sparkline with <2 data points (suppressed). Pure-display module — no native deps, no SEA stub needed; the SQLite reader lives in the audit-history module and is already SEA-stubbed.

**What changes for engineers**. Before v2.33.0: `kj audit` produced a textual list of LLM findings; "did this PR improve the codebase" had no answer except eyeballing the diff. After v2.33.0: every run gives a number, a grade, a delta vs last time, and a sparkline over time — all deterministic, all reproducible, all free. The golden number lets a team plot AI-friendliness as a chart over a sprint instead of guessing whether things are getting better. KJC-PCS-0051 closes in two phases: Plan A (v2.32.0) made Karajan's CI as strict as the scorecard demanded; Plan B (v2.33.0) made the scorecard a permanent fixture of Karajan's own audit output. 5 250+ tests passing across 466 files.

## Phase 86: Multi-language RAG + Quality & Observability (v2.34.0)

Two parallel epics — **KJC-PCS-0052** and **KJC-PCS-0053** — close in the same release window. Phase 86 is the largest release of the v2.x line so far in terms of subsystem expansion: the Project RAG stops being a JavaScript/TypeScript island and grows first-class support for **Python, Rust, Go and Java**, while a separate epic turns retrieval quality from a vibe into a measured signal with golden queries, content-hash dedup, MMR diversification, and a deep-dive doc. Seventeen PRs total, 5 368 / 5 368 tests passing across 482 test files.

**KJC-PCS-0052 — Multi-language RAG.** Four AST chunkers ship in this window using **`web-tree-sitter` WASM grammars** vendored under `vendor/tree-sitter-grammars/` so SEA binaries keep working without runtime downloads. **Python** (KJC-TSK-0478, PR #884), **Rust** (KJC-TSK-0479, PR #885), **Go** (KJC-TSK-0481, PR #886), and **Java** (KJC-TSK-0486, PR #888) each contribute a chunker that walks the parse tree, extracts top-level functions, classes / structs / impls / interfaces, and methods, and tags chunks with `kind` metadata that the kind-boost re-ranker already understands from JS/TS. A new **language adapter registry** (`src/lang/registry.js` → `adapterForPath(file)`, KJC-TSK-0474 PR-A) routes each file path to its adapter; the indexer wires `preparePython` / `prepareRust` / `prepareGo` / `prepareJava` alongside the existing JS/TS path (KJC-TSK-0480, PR-B.2.4). **Multi-stack collectors** in `kj audit` (PR-C) recognise Python (pyproject/poetry/requirements), Rust (Cargo.toml), Go (go.mod), and Java (pom.xml/build.gradle) projects and adapt the dependency / license / SAST checks accordingly; **`kj onboard` multi-stack** (PR-D) mirrors the detection so the first-run experience is consistent. The watcher (KJC-TSK-0482, PR #893) now follows source extensions for every supported language, not just `.js` / `.ts`.

**KJC-TSK-0455 — Incremental reindex by git diff.** A new `vec_store_meta` table tracks `last_indexed_commit`. `kj rag index --since <ref>` reindexes only the files changed between `<ref>` and `HEAD`, instead of crawling the whole tree. A **post-merge git hook** auto-fires the incremental reindex after every merge; a **pre-run drift check** compares `HEAD` vs `last_indexed_commit` and warns when they diverge, so a stale index can't silently mislead the retriever. Two PRs (#882, #883).

**KJC-PCS-0053 — Quality & Observability.** **Golden-query harness** (KJC-TSK-0483, PRs #899 / #900): a new `kj rag eval` command runs a curated set of queries against the current index and reports **recall@k** (binary: did the expected doc make it into the top k?) and **MRR** (pure mean reciprocal rank). A baseline JSON is committed to the repo; changes to chunker / embedder / hybrid weights are now evaluated against a measurable signal instead of vibes. **Content-hash dedup** (KJC-TSK-0484 PR-A, PR #895): every chunk gets a sha256 fingerprint; the indexer skips re-embed when the hash matches the stored row. **MMR diversification** (KJC-TSK-0484 PR-B, PR #896): an MMR pass at the top of the retriever (λ=0.5) diversifies the top-k so the LLM receives spread instead of N near-duplicates of the same paragraph. **`docs/RAG.md` deep-dive** (KJC-TSK-0485, PR #894): the reference doubles in scope — per-stack chunker behaviour, hybrid weighting math, eval workflow, hash-skip semantics, MMR tuning, multi-stack quirks.

**What changes for engineers**. Before v2.34.0: RAG worked great on JS/TS, was a black box on other languages, and retrieval quality changes were measured by eyeballing query results. After v2.34.0: any Python, Rust, Go, or Java codebase gets the same chunker quality JS/TS already had; any change to the retrieval pipeline can be A/B-tested with a single command (`kj rag eval`) and produces a concrete recall@k / MRR delta; the index stays cheap to keep current (hash-skip on re-embed, `--since` for incremental reindex, post-merge hook for automation). The seventeen PRs (#882, #883, #884, #885, #886, #888, #889, #890, #891, #892, #893, #894, #895, #896, #898, #899, #900) close both epics in full.

## Phase 87: v3.0.0 — Node 22+ runtime move (v3.0.0)

Phase 87 marks the **first major** of the v3 line. The story is short and unglamorous on purpose: **Node 20 hit end-of-life on 2026-04-30**, and three dependency majors that depend on Node 22 were stacking up in the queue (`lint-staged 17` needs Node 22, `commander 15` needs Node 22.12, `better-sqlite3 12.10` removes Node 20 prebuilds). Rather than ship four staggered minors each papering over one constraint, v3.0.0 cuts a single major that bundles the runtime move with the dep majors that depend on it.

**No public API changes.** `kj run`, `kj plan`, MCP tools, role templates, RAG, HU Board, audit, telemetry — all identical to v2.34.0. The breaking change is exactly one line of `package.json`: `engines.node` moves from `>=20.10` to `>=22.22.1`. Adopters already on Node 22 install with `npm install -g karajan-code@3` and notice nothing different; adopters still on Node 20 bump their runtime first.

**Why a major?** Semver. Changing the minimum Node version is a breaking change for downstream consumers — period. The CHANGELOG's `Why a major?` section spells out the rationale so adopters understand the runtime bump is the breaking change, not any CLI surface. The alternative — four staggered minors over a month, each marked "soft-breaking, please upgrade Node when convenient" — would have spread the same pain across four release windows for no gain.

**Bundled in v3.0.0**: PR #918 (KJC-TSK-0500, `engines.node` 20.10 → 22.22.1), PR #920 (KJC-TSK-0491, `lint-staged` 16 → 17), PR #922 (KJC-TSK-0490, `commander` 14 → 15), PR #923 (KJC-TSK-0488, `better-sqlite3` 11 → 12.10), and PR #926 (KJC-TSK-0202, README footprint & hardware requirements section so adopters can size their machine before they install). 5 368 / 5 368 tests passing across 487 test files — same surface as v2.34.0, same green.

**Migration is one command.** `nvm install 22.22.1 && nvm use 22.22.1 && npm install -g karajan-code@3 && kj doctor`. Existing `~/.karajan/` (sessions, plans, RAG index, audit history, HU Board DB) is forward-compatible — nothing to migrate by hand. v3.0.0 is a runtime + deps bump release, not a feature release; the next minor (v3.1.0) is when the Brain rewrite work resumes.

## Phase 88: v3.1.0 — Quality gates + housekeeping + auditor (v3.1.0)

Phase 88 is the **first minor on the v3 line**. No breaking changes; drop-in upgrade from v3.0.0. The release bundles five tracks landed since v3.0.0 — two new quality gates in the pipeline, three new housekeeping commands, a semantic test-diet auditor, the HU Board structural refactor, and a batch of security + flake fixes.

**Quality gates.** The pipeline gets two new stages. **Tool-correctness judge** (KJC-TSK-0375) is a role + stage shipped across three PRs (#964 role/prompt, #965 tool-call extractor from agent transcripts, #966 stage wired into quality-gates) that scores whether the coder used the right tools for the job. **TDD-discipline** (KJC-TSK-0398) is shipped across three PRs (#957 module + config flag, #958 surgical stash helper, #959 pipeline wiring) and verifies tests were written before the implementation via a surgical stash + diff inspection of the working tree.

**Housekeeping.** Three new flags in `kj clean` (KJC-TSK-0499) — `--repo` (stale branches, dist, tmp candidates, PR #930), `--vector-stores` (orphan RAG indexes, PR #931) and the `--all` paraguas (PR #932 + `docs/CLEANUP.md`). **`kj sync --apply`** (KJC-TSK-0348, PR #967) closes the SPDD loop by writing the canvas drift patch with backup.

**Semantic test-diet auditor** (KJC-TSK-0345, PRs #968 + #969). New `scripts/audit-test-diet.mjs` + `npm run audit:test-diet` complements the existing LOC-bucket auditor with five loss-of-meaning categories: empty-no-expect, skipped-pending, imports-orphan, deprecated-export, subsumed-candidate. The subsumed-candidate rule requires ≥50% `it()` name overlap on top of the import subset — purely import-based subsumption produced a false positive on `tests/budget.test.js` (refined out in PR #969). Used to verify the 498-test suite has 0 findings — the suite is clean.

**HU Board.** Canonical statuses on the API (KJC-TSK-0394, PR #962, legacy values trigger a suggestion) + a 17-PR structural refactor (KJC-TSK-0501, PRs #936–#954) splitting `packages/hu-board/public/app.js` into `utils/` modules: formatters, modals, api, sessions-view, board-view, dashboard/graph views, story detail + project picker, preflight + log panel + plan rollup, HU action handlers, project actions modal, story edit form, config editor, command launcher, preflight + run launcher, server-push updates, initialization listeners.

**Fixes**: prototype-pollution guards in `setDeep` / `setDotPath` (KJC-BUG-0076, PR #933), harness-scorecard Docker classification (KJC-BUG-0077, PR #935), `ollama-capability` freemem flake (KJC-BUG-0078, PR #939), hibernate e2e clock pin (KJC-BUG-0079, PR #963), vitest tmp dirs cleanup (KJC-BUG-0075, PR #929).

**Stats**: 498 test files, 5 400+ tests passing. 39 commits since v3.0.0. PRs #928–#969 + release #970.

## Phase 89: v3.2.0 — Cost tracking end-to-end (v3.2.0)

Closes the **Cost** epic (KJC-PCS-0055) — seven slices Cost A through Cost G land in one release, completing the loop from token spend to user-facing UI.

**Cost A — pricing registry** (KJC-TSK-0512). `model-pricing.json` ships input/output USD-per-token for Claude, GPT, Gemini, and local models. Exact-match lookup with prefix fallback; versioned so adopters can audit the rates that produced their bill.

**Cost B — aggregator** (KJC-TSK-0513). `aggregateRunCost()` reduces a `BudgetTracker` entry list into `{totalUsd, byModel, byProvider, unknownModelTokens}`. Unknown-model tokens are surfaced separately instead of silently dropped, so the user can spot pricing-table gaps instead of trusting a low total.

**Cost C — schema** (KJC-TSK-0514). Idempotent migration adds `cost_usd REAL` on `stories`. The semantic is sharp: NULL = unmeasured, 0 = real free run. Anything that flattens both into "$0.00" lies.

**Cost D — orchestrator hook** (KJC-TSK-0515, PR #1031). The session `BudgetTracker` is cumulative across all HUs, so a naive read would stamp every HU with the running total. Instead, `runSingleHu` snapshots `entries.length` at start and slices on exit; `setLiveOutcomeUpdater` then lazy-imports `hu-board/db.js` and writes the slice's sum via `setStoryCost`. Lazy import keeps the pre-loop free of board deps.

**Cost E — API** (KJC-TSK-0516). `GET /api/projects/:id/cost` returns `{totalUsd, byPlan, unknownModelTokens, currency}` for a project. Aggregates across plans, exposes unknown-model leakage so the UI can show the "$X (Y tokens with unknown pricing not included)" disclaimer.

**Cost F — card badge** (KJC-TSK-0517). `formatCost(cost_usd)` returns `{label: "$0.02", tooltip: "Estimated cost: $0.0234"}` — two precisions atomically, so the renderer can't accidentally show one without the other. Null input returns null → badge hides → no misleading "$0.00".

**Cost G — header chip** (KJC-TSK-0518, PR #1030). `formatProjectCostSummary` builds a `Total: $1.54` chip with a multi-line `By plan: ...` tooltip including HU counts. Same null-safety as F.

**Why a minor**. Additive only; no API or CLI surface change. The `cost_usd` column is new but downstream readers either handle NULL (board UI, ours) or ignore the column entirely (older readers).

**Stats**: 187 LOC for Cost D alone (well under the 200-budget cap). Cost A–G shipped as separate PRs to keep each slice reviewable in isolation.

## Phase 90: v3.3.0 — Cross-provider cache observability (v3.3.0)

Closes the **Phase 0** epic (KJC-PCS-0056). Karajan had cost end-to-end (Phase 89) but not cache_pct — a coder could double the cache hit ratio and the journal would not notice. Phase 0 closes that blind spot across **Anthropic, OpenAI/Codex, Gemini, aider and opencode** in eight surgical slices Φ0-A through Φ0-H, all landing in one release.

**Φ0-A — anthropic passthrough** (KJC-TSK-0519). `usage.cache_read_input_tokens` flows through `claude-agent.js` into the BudgetTracker entry. Already canonical; this slice just stops dropping it on the way through.

**Φ0-B — codex passthrough** (KJC-TSK-0520). `usage.prompt_tokens_details.cached_tokens` extracted from the codex-cli JSON response shape and normalized to the same `cached_tokens` field. Live e2e is blocked by host bwrap; covered by unit tests on the response shape.

**Φ0-C — gemini context-caching** (KJC-TSK-0521). `usage.cachedContentTokenCount` extracted from the Gemini API response. Cold→hot Gemini sample on a Karajan repo shows 87.9% → 96.8% cache_pct, validating the shape.

**Φ0-D — aider + opencode via LiteLLM** (KJC-TSK-0522). Both wrap LiteLLM, which normalizes to `usage.cached_tokens`. One adapter, two agents covered.

**Φ0-E — BudgetTracker cursor-snapshot** (KJC-TSK-0523). `budget.js::computeUsage()` reduces the four provider shapes into a single canonical `cached_tokens` per entry. `summary()` exposes `breakdown_by_role.{coder,reviewer}.{tokens_in,cached_tokens,cost_usd}`. The cursor-snapshot pattern (same as Cost D) keeps per-HU slices independent of the cumulative session tracker.

**Φ0-F — summary.md "Cache hits" section** (KJC-TSK-0524). Each run's `summary.md` gains a `## Cache hits` block with a `tokens_in / cached_tokens / cache_pct` line per role. Null-safe: section omitted when no role surfaced cache data.

**Φ0-G — HU Board cached badge** (KJC-TSK-0525). `formatCacheRatio(cached, tokens_in)` returns `{label:"🎯 N%", tooltip}` or null. The card hides the badge when `tokens_in=0`, distinguishing "unmeasured" from "0% hit ratio" — same null-vs-zero hygiene as Cost F.

**Φ0-H — telemetry computeCachedPct** (KJC-TSK-0526). `pipeline_complete` event gains `cached_tokens_pct: { coder, reviewer }`, with `null` per slot when its `tokens_in=0`. Future tracking-by-cohort lands without re-instrumenting.

**Real data measured 2026-06-09 on a Karajan repo**: cold Claude run 47.2% cache_pct ($0.6141), hot run 94.3% cache_pct ($0.1452) — **76.4% cost reduction** on a sustained-prompt workload. Gemini 87.9% → 96.8% on the same shape. Codex measured by unit tests (live e2e host-blocked).

**Why a minor**. Additive only; no API or CLI surface change. The badge and summary section render only when measured; downstream consumers either honour the new field or ignore it. Drop-in upgrade from v3.2.0.

**Stats**: eight PRs across eight cards. Each slice landed independently, all under the 200-LOC budget. v3.3.0 is the foundation for Phase 1 (cost-aware planner — choose a model per role based on cache_pct × cost_usd predictions).

## Phase 91: v3.4.0 — Cache-friendly prompts (v3.4.0)

Phase 1 of the cache roadmap (epic KJC-PCS-0057) acts on what Phase 0 measured. Every prompt builder now emits a `{ stable, volatile }` layout via `src/prompts/prompt-layout.js`: the stable block (preamble, rules, constraints, skills, contexts) is byte-identical across iterations of the same HU and across HUs of the same plan, and renders first; the volatile tail (task, plan, acceptance tests, reviewer feedback, git diff) keeps its legacy relative ordering.

Two levers per provider family: OpenAI/Gemini/LiteLLM-routed CLIs cache automatically on the literal token prefix, so the reorder alone activates them; Anthropic caches on CLI-placed breakpoints in the system block, so `ClaudeAgent` ships the stable bucket via `--append-system-prompt` and only the volatile tail in `-p`. Implicit rollback: roles that do not provide buckets keep the legacy single-prompt behavior.

Measured on real runs (2026-06-11): Claude coder cold cache_pct 47.2% → 99.60%, hot 94.3% → 99.69%, coder cost per HU $0.6141 → $0.1447 (−76%). Both runs APPROVED with the final audit CERTIFIED. A prefix-stability regression suite (longest-common-prefix assertions + OpenAI's 1024-token floor + volatile-leak markers) freezes the contract in CI. Six slices, PRs #1044–#1050.

## Phase 92: v3.4.2 — Post-Phase-1 hardening + the pre-publish gate (v3.4.2)

The maintenance line that turned a recurring embarrassment into a structural guarantee. Three npm releases (v3.2.0, v3.3.0, v3.4.1) had shipped unable to run even `kj --version`: the test suite ran against the linked workspace (symlinks resolve everything), while the published tarball — with `bundleDependencies` and top-level resolution — was never installed or executed anywhere in the pipeline.

v3.4.1 carried the post-Phase-1 cleanup (journal-on-every-ending KJC-BUG-0084, audit cached_tokens KJC-BUG-0085, Sonar preflight fail-fast KJC-BUG-0083, plus the audit top: escapeRegExp, dead-export pruning, regex decomposition, HU Board fs-async + plan cache) but broke install: `@karajan/core` dragged `sqlite-vec` into the bundle and its `files: []` left it without an entry point.

v3.4.2 fixes the root cause two ways. **Resolution**: core's runtime deps (better-sqlite3, execa, sqlite-vec) become `peerDependencies`, resolved complete from the consumer's top-level install. **Process**: `scripts/verify-pack.mjs` packs the real tarball, installs it into an isolated tmpdir and runs `kj --version` / `--help`, wired as `prepublishOnly` (the publish aborts itself if the artifact does not start) and as the `pack-smoke` CI job on every PR (KJC-TSK-0553). A `core-no-bundled-deps` regression test freezes the dependency contract. v3.4.1 was deprecated on npm; v3.4.2 is the first fully-clean 3.x install.

## Phase 93: v3.5.0 — Quality harness (kj harden + kj check) (v3.5.0)

The epic that turns "the way Karajan was built" into a product surface. `kj harden` (KJC-PCS-0059) installs the whole quality harness into any repo — new or existing — in one command: git hooks, lint/format/commit config, CI quality gates and AI-agent guidelines, all idempotent, stack-aware, and bounded by `kj:managed` markers that never overwrite the user's content.

The defining constraint is **no imposed runtime**. The installed hooks call the project's own toolchain — `go vet`/`gofmt`/`go test` for Go, `ruff`/`pytest` for Python, package.json scripts for JS/TS — and the commit-msg hook (Conventional Commits + 100-char cap + AI-attribution block) is pure POSIX. So hardening a Go, Python or Java repo never makes Node a commit-time dependency for its contributors; Node is needed once, by whoever runs `kj harden`. A fullstack monorepo is detected per language root, so each side gets its own config in its own folder.

`kj check` verifies the harness as a CI drift gate (exit 0/≠0, `--json`) and surfaces the greenfield gap — a language added after hardening whose config was never seeded. `kj init` runs the same engine, so a freshly initialised project is hardened out of the box. The harness logic and guideline generation were absorbed from the author's `dev-toolkit` so Karajan depends on no external MCP. Eleven PRs across nine slices (H-A…H-G + H-B2 + H-C2); 5 717 tests passing; clean install verified.

## Phase 94: v3.6.0 — Advisory harden (v3.6.0)

The harness learns to **compare instead of just install** (epic KJC-PCS-0060). A read-only comparison engine classifies every managed artifact in an existing repo as **missing**, **user-owned**, or **kj-managed** (up-to-date or outdated), recognising equivalent config formats (legacy `.eslintrc.*`, `.commitlintrc.*`, inline `package.json` keys) so it never reports a false missing — and for a user's own config it lists the concrete improvements the kj standard would add. `kj harden --report` surfaces that per artifact (plus `--json`); `kj harden --interactive` lets the user adopt the standard piece by piece, default-safe (keep yours unless told otherwise). Scope control — demo/fixture dirs ignored by default, plus `--only`/`--exclude` and per-repo `package.json` `kj.harden` — keeps hardening off examples and sub-tools.

The release also rounds the first run: `kj init` drops the cold scope question, gates advanced per-role agent routing behind one opt-in, speaks consistent English with glossed terms, no longer leaks the Squeezr update banner, and ends with a clear next step. And it closes a real packaging gap — the `kj-trash` safety net (snapshots of destructive ops) was never in the published tarball; it now ships as a root bin, guarded by an extended verify-pack gate so it can't regress.

## Phase 95: v3.7.0 — Autonomous delivery (v3.7.0)

The culmination of the vision: given a spec, Karajan plans, decomposes into HUs and runs to completion **with no human in the loop** (epic KJC-PCS-0062). A single autonomy axis — `interactive | assisted | autonomous`, resolved flag > env > config > default — routes every would-be human decision through one choke point that either asks the human or hands it to **the Arbiter**. The Arbiter resolves agent conflicts (reviewer vs coder, an acceptance test that won't pass after N iterations, an ambiguous spec) by picking the **least-bad** answer against a fixed ground-truth order: acceptance tests outrank reviewer must-fix, which outrank nice-to-have; on a parse failure it degrades conservatively rather than blocking.

`kj autorun <spec>` chains plan → run → outcome report atomically with exit-code propagation. In autonomous mode the pipeline stages never block on a prompt and a wall-clock backstop guarantees a run can't hang, so the loop always terminates with a **DELIVERED / INCOMPLETE** report that lists HUs met/unmet and any residual defects — perfection is not the bar, meeting the ask is. The default stays `interactive`, so existing interactive runs are byte-for-byte unchanged. The spine was live-verified end-to-end on real specs (real coder + reviewer, `node --test` passing, no human).

## Phase 96: v3.8.0 — kj start (v3.8.0)

The Brain gets a front door. **`kj start [intent]`** is the single entry point to the autonomous squad (epic KJC-PCS-0061): the user states an intent and, at most, the project's maturity — the Brain orchestrates everything else, read-only, before proposing anything. A deterministic **maturity classifier** infers `new | existing | legacy` from signals (scaffolding only, real code + tests + CI, or neglected health) and a **read-only sweep** runs the assessment commands (`doctor` / `check` / `harden` / `onboard`) without touching the user's code — `init` only ever writes `.karajan/`. The sweep is condensed into a stable report, and a cheap **decider role** picks the next intent from a **closed set**; the loop maps each writing intent to an existing saved command + args and **confirms before anything that writes** — the model never runs commands on its own, and the user never has to learn `doctor`/`check`/`harden` directly.

Two supporting moves ship alongside it. **`kj advanced`** trims `kj --help` down to the core commands and indexes the full surface under one namespace, guarded by a help-parity gate. And **inbound secret redaction** (KJC-TSK-0583) closes the counterpart to the existing outbound commit guard: a hardcoded credential in the working tree used to reach the (possibly cloud) reviewer model verbatim inside the diff; `src/guards/secret-redactor.js` now masks every secret before the model sees it, reusing the existing `CREDENTIAL_PATTERNS` catalog (deterministic, no AI cost, no-op on clean text) while preserving an identifiable prefix (`AKIA***REDACTED***`, `sk-ant-***REDACTED***`) so the reviewer can still flag "move this to .env" without ever seeing the value.

## Phase 97: v3.9.0 — Standalone binaries (v3.9.0)

Karajan becomes installable on a machine with no Node at all (epic KJC-PCS-0006). The release ships prebuilt `kj` executables — `linux-x64` and `win-x64` — built with Node's Single Executable Application (SEA) machinery, so the whole CLI is one self-contained file. A **node-free installer** lands it: `curl -fsSL https://karajancode.com/install.sh | sh` on Unix (POSIX `sh`, no bashisms) and `irm https://karajancode.com/install.ps1 | iex` on Windows, each verifying the binary's SHA256 before it touches disk, dropping it in `~/.local/bin` / `%LOCALAPPDATA%\Karajan`, and clearing the OS's downloaded-file block — `xattr` quarantine on macOS, mark-of-the-web via `Unblock-File` on Windows — on the copy it just checksummed. The "update available" banner is now channel-aware: it detects whether `kj` runs as a SEA binary (`node:sea`) or from npm and prints the matching upgrade command. macOS shipped via npm for now while the `darwin-arm64` build was still being hardened.

Release integrity is the other half of the story, learned the hard way from earlier broken publishes. The `v*` tag now **creates the GitHub Release from the matching CHANGELOG section first** — the SEA upload needs the Release to already exist, which had been the post-publish "run failed" gap — and every built binary must **smoke-test (boot `--version` / `--help`) before its asset is uploaded**, so a broken executable is caught in CI rather than by the first user to download it.

## Phase 98: v3.10.0–v3.10.1 — The macOS binary made real (v3.10.1)

The Apple Silicon binary goes from "does not exist" to "runs a real task". **v3.10.0** got it to boot: the `darwin-arm64` build had been segfaulting on startup (exit 139) because `postject` on Mach-O needs `--macho-segment-name NODE_SEA` for the SEA blob to land where Node's loader looks — without it the blob went to a segment the loader never inspected (KJC-BUG-0096). The flag is Mach-O-only, so it is applied on macOS builds alone. A `macos-latest` CI job now builds and boots the binary on every change to the SEA build, because Node upstream only CI-tests single-executables on Linux and a macOS crash could otherwise surface only at release time. While the gap lasted, the installers stopped fetching a binary that would not run and pointed macOS users cleanly at npm.

**v3.10.1** got it to actually work. Booting was never proof the bundle wired up: every binary passed `--version` / `--help` / `init` yet died on `kj run` with `maybeAutoUpdate is not a function` (KJC-BUG-0097). The SEA bundler stubs out `src/rag/*` to keep native SQLite out of the executable, and `src/rag/auto-update.js` was caught by that filter — but `run.js` calls its `maybeAutoUpdate()` on every run. The stub now re-exports it as a silent no-op (RAG auto-update is unavailable in the binary anyway), and the `sea-smoke` gate plus the `sea-build` test were widened to exercise `kj run` itself, not just boot. With that, the macOS Apple-Silicon binary ships alongside `linux-x64` and `win-x64` in the GitHub Release — the "have it for Mac" goal met.

## Phase 99: v3.10.2 — Privacy, path containment & triage transparency (v3.10.2)

A patch that rolls up three unrelated fixes, each worth shipping. **Privacy**: a personal email address had leaked into user-facing package metadata; it is replaced with the public handle so scrapers cannot harvest it (#1156) — the same class of incident that made output sanitization a standing rule. **Security**: direct-action file writes (`create_file`, `git_add`) had confined their target to the project directory with a string-prefix check, which a sibling path like `../project-evil` could slip past; the guard now uses a `path.relative`-based containment test, so a crafted path cannot escape the repo (KJC-BUG-0098). **Observability**: triage decided which roles to activate but exposed only one global `reasoning` blob — the per-role *why* was invisible. Triage now emits a deterministic `roleRationale` (role, enabled, source, reason) mirroring the activation logic, rendered under the `triage:end` event so each activate/skip decision is auditable; it describes each role's trigger rather than a per-task claim, so it is never invented. The release also records the project's **by-design non-goals** in `docs/design-decisions.md` — why `npm install` is not run with `--ignore-scripts`, why there is no built-in sandbox, why there is no user-editable YAML/JSON config — so reviews stop re-proposing them (KJC-TSK-0602).

## Phase 100: v3.11.0 — install-tools becomes the actuator (v3.11.0)

`kj install-tools` had a split identity with `kj doctor`: both told you what was missing, neither installed it. This release makes the split clean — `kj doctor` is the diagnostician, `kj install-tools` is the **actuator** that actually installs the external audit tools Karajan does not bundle (semgrep, osv-scanner, lighthouse, docker, sonar). The command is a wizard: it shows the exact command for each tool and installs on accept (epic KJC-PCS-0006). The primitives underneath keep the two safety promises that make an installer trustworthy. Privileged installs run `sudo` on the user's own tty, so **kj never captures or logs the password** (KJC-TSK-0606); binary downloads land in a temp file, get `chmod 0755`, then atomically rename, so a failed download never leaves a half-installed artifact. On a machine with no package manager, osv-scanner installs from its GitHub static binary and semgrep falls back to a concrete Docker/pipx command rather than a bare docs URL (KJC-TSK-0607). Docker on Linux prefers the distro package manager (`apt` → docker.io, `dnf` → docker) or downloads Docker's official convenience script to a file and runs it with sudo — **never `curl | sh`** — and is opt-in, defaulting to no with the command shown first; macOS/Windows point at the official docs (KJC-TSK-0609). Messaging names the concrete next step instead of a URL: sonar states it needs Docker first, and a tool with no package manager gets pointed at `kj doctor` (KJC-TSK-0610). Riding along: three role refinements from the community *Augmented Coding Patterns* catalogue — active-partner dissent (KJC-TSK-0603), a check-alignment micro-gate (KJC-TSK-0604), and affirmative rewording of high-impact instructions (KJC-TSK-0605) — plus two install-path fixes: the RAG post-merge hook now honours `core.hooksPath` so a hardened repo actually reindexes after a merge (KJC-BUG-0100), and the macOS installer selects the `darwin-arm64` asset (KJC-BUG-0101).

## Phase 101: v3.14.0 — Step mode and governed parallelism (v3.14.0)

Two new execution modes. `kj run --step` gates every iteration behind a compact report (reviewer verdict, next step, spend vs cap) where free-text answers become directives the coder reads next iteration. `kj run --parallel <n>` runs a plan's HUs concurrently in per-HU git worktrees, scheduled over the blocked_by graph with conservative scope isolation, a shared semaphore and a plan-level budget ceiling; the SonarQube stage serializes across lanes. The previously unbounded parallel path now defaults to 1 — sequential — and is strictly opt-in.

## Phase 102: v3.15.0 — Lanes for real projects, priced providers, decoupled board (v3.15.0)

Three convergent moves. Parallel worktree lanes became viable on real codebases: fresh worktrees bootstrap themselves (submodules + dependency install) and each lane gets a stable slot from a file-locked registry, exported as `KJ_LANE_SLOT` / `KJ_PORT_OFFSET` so test-started services offset their ports (design after Jorge del Casar's worktree-docker-envs skill). The model registry learned Moonshot's Kimi K2 and DeepSeek with real pricing, reached through OpenCode as OpenAI-compatible providers — cost tracking stops flying blind on non-native models. And the HU Board completed its independence: the rag subtree moved into `karajan-core/rag`, the board resolves everything through the package, and an architecture test forbids relative imports into the CLI tree. Two operational lessons were burned into the process: publish karajan-core BEFORE merging its consumers, and modern pnpm's release-age quarantine can silently resolve stale dependencies (the pack gate now opts out).

## Phase 103: v4.0.0 — Karajan Environment: the host agent orchestrates, Karajan governs (v4.0.0)

The architectural inversion. A complex real-world demo (2026-07-19) exposed an integral false green in the subprocess model — a run finished "approved" with zero reviewer passes, no post-loop and no push — while days of the inverse model (a human tasking a host agent under deterministic git gates) never let one error through. v4 made the inverse model the product. Three layers: a **playbook** (`kj env install`) rendered from one source into CLAUDE.md and AGENTS.md that orders the method (RAG before coding, card first in the configured `state_backend`, TDD, cross-AI review); a **first-class review primitive** (`kj review --staged`) that routes every diff to an AI different from the host and records the verdict keyed by the sha256 of the raw diff; and a **pre-commit gate** (`kj review --install-gate`, marker tracked in git) that rejects any commit without a matching approved verdict — resolve-until-pass by construction. The RAG index is built on install and delta-updates before every query. The subprocess pipeline survives as the headless mode: its sessions stamp their internal reviewer's verdict so both worlds share one gate. The repo governs itself with its own environment; in its very first governed commit, the cross reviewer rejected the author's initial version with two legitimate issues — the design proving itself on day one.

## Phase 104: v4.2.0 — Deterministic pre-gate: sonar before any AI opinion (v4.2.0)

The gate learns to measure before it judges. With the brain outside the core, skipping static analysis was one decision away — proven the day the brain itself shipped three sonar issues in new code and nothing stopped it. Since v4.2.0, `kj review --staged` runs SonarQube as a deterministic pre-gate: one scan machine-wide (single-flight through the v4.1.10 tool governor), findings filtered to the CHANGED files and printed before any AI verdict. BLOCKER/CRITICAL findings reject on the spot — exit 1, cross-AI reviewer never invoked, zero tokens spent on code a linter already condemned. Advisory findings travel inside the reviewer's task so the verdict weighs them. A machine without sonar degrades loudly and continues — the gate never bricks a laptop. On its first live run, the pre-gate reviewed its own diff and surfaced three pre-existing issues in the very file that implements it, fixed in the same PR.

## Phase 105: v4.5.0 — Any board, but always a board (v4.5.0)

The board stops being kj's and becomes the project's — without ever becoming optional. Card-first was always the method's spine, but it assumed kj's own HU Board; projects already living in Linear, Trello, Jira or GitHub Issues ended up with two half-boards, which is worse than none. Since v4.5.0 the project declares its backend: kj's HU Board (default), the Planning Game MCP, or any external board by name — and the playbook points card-first at THAT board, worked through the host agent's own MCP/tools, with kj refusing to mirror it. The counterweight is a guarantee: `kj env install` verifies an operational access path to whatever board was declared — bundled, MCP configured, or API token exported — and blocks with the exact steps when there is none, before even touching the RAG. There is no `none`: Karajan does not run without a board, because the board is what makes ordered work, honest cards and meaningful lanes possible.

## Phase 106: v4.6.0 — The method, enforced (v4.6.0)

The v4 trade named and closed. v3 commanded but couldn't think — it looped, it lacked judgment; v4 thinks but narrates — an intelligent agent can tell the story of a rule instead of following it, and the field proved it three times in one week. The answer is a ladder every method rule climbs to its deterministic ceiling: text (narratable) → trail (unfalsifiable) → nudge (in-the-moment friction) → gate (structurally unskippable). v4.6.0 climbs four rules at once: **card-first becomes a gate** — with the bundled board, a branch without a live card cannot commit; external boards get a presence check; **tests-with-code becomes a gate** — sources without a single test change warn or block; **worktree-per-task and PR size become nudges** — the exact command at the exact moment of deviation; and **adherence becomes a report** — `kj check` shows commits without cards, verdicts by workspace, testless commits, because individually legitimate deviations aggregate into visible drift. Every escape hatch is explicit, named and logged. The design rule going forward: a method rule is born with its gate or its trail — text is the reminder, never the guarantee.

## Phase 107: v4.7.0–v4.8.0 — Least privilege, and the security pass an agent self-invokes

A payments processor published how it operates AI agents safely, and its principles mapped almost one-to-one onto Karajan's gates — except three, closed in two releases. **Agents get only what their function requires**: spawned subprocesses receive an env allowlist (their own CLI's auth families, never your cloud keys — with a Solomon-arbitrated contract deciding when an explicit env is complete versus an overlay), and `kj check` keeps an inventory of every MCP the project can reach, flagging what appeared since the last check — an inventory nobody reconciles is the feeling of control without the control. And **security becomes self-service**: `kj audit --security` runs a zero-token deterministic pass — prompt-injection over the agent-context surface (the rules files, templates and specs that enter the agent's context every session), OSV, Semgrep, Sonar — ordered by the playbook whenever a task touches auth, user input, secrets, network or dependencies: design → scan → remediate, same session.

## Phase 108: v4.9.0 — Excellent code is a choice, not inertia

On legacy codebases agents optimize for local coherence — improving while following the existing line — even when the canonical solution is better; nothing in the loop asked for the alternative. Now the method does, twice. The **alternatives clause**: every non-trivial plan names at least two approaches, one answering "what would you build if this code didn't exist?", and says why the winner won — following the legacy line is a choice, never a default. And the **library**: a distilled engineering canon as its own RAG collection — pattern cards with the problem signature, when it beats the default, when NOT to apply it (half the value), and the canonical citation — so the architect grounds that greenfield alternative in citable canon instead of vibes. Lamport shipped first; the canon grows with the family's radar as its future feeder.

## Phase 109: v4.10.0–v4.11.0 — Nothing personal ships, and installing IS activating

Born from two field cases in one weekend. A real incident (personal emails published on a landing inside release notes) became the **Privacy Gate**: every outbound boundary — staged diff, npm tarball, any build output — audits before it leaves the machine, with two layers at each: your personal denylist (asked and written by the install itself, never YAML by hand) blocks; generic PII and hardcoded platform tokens (`ghp_`, `sk-`, `AKIA`…) block or warn toward `.env`. Findings never echo the datum they flag. And a session that "installed karajan" then wrote a whole feature by hand exposed the deeper hole: **the installation itself was narratable** — setup steps were text an agent could skip. Now `kj env install` performs the enforcement itself (git hooks, verdict gate, and a tool gate that blocks `Write` over existing files at tool-invocation time), prints the method into the very conversation that installed it, wires the RAG as a native MCP tool, and asks which board governs instead of defaulting silently. A commit outside the method is rejected, not narrated — and so is an install.

## Phase 110: v4.12.0–v4.13.0 — The check is the guarantee, and the program rules

Two answers to the same critique: *"whatever you note down, you eventually ignore it."* First the release ceremony stopped depending on memory — `kj release check` verifies it deterministically (manifest vs CHANGELOG, tags, a privacy scan of the exact publishable files, plus each project's declared truths like "the deployed site shows this version"). Then the critique hit its deepest form: an agent as brain cannot be strict about its own rules. The **Karajan Sentinel** (epic complete in a day, v4.13.0) restored the missing power: a deterministic, zero-LLM supervisor with synchronous authority over the agent through the harness's hooks. Method state recorded per session; sensitive operations blocked BEFORE the damage (source edits without a card, publishes with a red release check, pushes with open violations); and a Stop hook that keeps the turn open until violations are resolved. Self-protecting — its scripts verified against the installed kj package as root of trust, every escape audited back to the user — and honest about its boundary: synchronous blocking hooks exist only in Claude Code, so the guaranteed level names its host. v3 had authority without intelligence; v4 intelligence without authority; the Sentinel separates the powers: the program rules, the agent thinks.

## Phase 111: v4.14.0 — The panel never runs dry

A real outage wrote this phase: codex exhausted its weekly quota mid-task, and every fallback the method assumed turned out dead or conflicted at once. The answer was structural, not circumstantial. A declarative registry of reviewer candidates — each with its tier, auth heuristics and exact login command — powers a **quota failover with consent**: switch to an authenticated candidate with a loud notice, or hand the user the menu; never silence, never self-review. The panel itself grew: Kimi Code (free tier) and Antigravity CLI (the gemini lineage back, under Google AI Pro) became the eighth and ninth built-in agents, each verified against its live CLI before a line of adapter shipped — and the debut exposed a real bug class twice in two days (a role's model pin travelling to a provider that cannot serve it), now closed at the root. Housekeeping with teeth: packages/ joined the lint surface after rotting to 1,124 errors precisely because nobody looked, and the lint script now makes that rot impossible.

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
- [Joan León](https://joanleon.dev/) — [WebPerf Snippets](https://webperf-snippets.nucliweb.net/) for Core Web Vitals measurement, inspiring the future WebPerf quality gate
- [ADR-001: Role-Based AI Architecture](/docs/architecture/overview/) — Architecture decision record in the karajan-code repository
- [Model Context Protocol](https://modelcontextprotocol.io/) — The standard used for Karajan's MCP server integration
