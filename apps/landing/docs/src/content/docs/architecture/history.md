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

**v1.51.0** — RTK real integration: auto-install during kj init, enforce wrapping in internal Bash commands, measure and report token savings per session. Audit/analysis tasks skip coder/reviewer and route directly to security+audit roles.

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
