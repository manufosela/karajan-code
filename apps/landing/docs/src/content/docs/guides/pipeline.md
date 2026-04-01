---
title: Pipeline
description: How the Karajan Code multi-agent pipeline works.
---

## Pipeline Overview

Karajan orchestrates **16 specialized roles** through a three-phase pipeline. Each role defines *what* to do; you choose *which AI agent* (Claude, Codex, Gemini, Aider, OpenCode) does it.

```
intent? → discover? → hu-reviewer? → triage → domain-curator? → researcher? → architect? → planner? → [coder → refactorer? → guards → TDD → sonar? → impeccable? → reviewer] → tester? → security? → audit? → commiter?
                                                                                                     └─── iteration loop (1..N) ──────────────────────────────────────┘
```

### Roles

| Role | Description | Default |
|------|-------------|---------|
| **discover** | Pre-execution gap detection — analyzes tasks for missing info, ambiguities, and assumptions | Off |
| **triage** | Pipeline director — analyzes task complexity, classifies taskType, detects domain hints, and activates roles dynamically | **On** |
| **domain-curator** | Discovers, proposes and synthesizes business-domain knowledge (from `~/.karajan/domains/` and `.karajan/domains/`) so all downstream roles work with real-world context — not just technical frameworks | Auto (when domains exist) |
| **researcher** | Investigates codebase context before planning | Off |
| **architect** | Designs solution architecture — layers, patterns, data model, API contracts, tradeoffs | Off |
| **planner** | Generates structured implementation plans informed by architecture | Off |
| **coder** | Writes code and tests following TDD | **Always on** |
| **refactorer** | Improves code clarity without changing behavior | Off |
| **sonar** | Runs SonarQube static analysis and quality gates | On (if configured) |
| **impeccable** | Automated UI/UX design audit — accessibility, performance, theming, responsive, anti-patterns. Includes WebPerf Quality Gate (v1.45.0): Core Web Vitals (LCP, CLS, INP) via Chrome DevTools MCP + WebPerf Snippets, with configurable thresholds | Off |
| **reviewer** | Code review with configurable strictness profiles | **Always on** |
| **tester** | Test quality gate and coverage verification | **On** |
| **security** | OWASP security audit | **On** |
| **solomon** | Pipeline Boss & Arbiter — evaluates every reviewer rejection, classifies issues, can override style-only blocks. 6 rules including smart iteration control | **On** |
| **commiter** | Git commit, push, and PR automation after approval | Off |
| **hu-reviewer** | HU story certification — evaluates user stories across 6 quality dimensions, detects 7 antipatterns, rewrites weak stories, supports dependency graphs | Auto (medium/complex) |
| **audit** | Mandatory post-approval quality gate — runs after reviewer+tester+security pass. Checks generated code for critical/high issues; if found, loops coder back to fix. If clean, pipeline is CERTIFIED | **On** (v1.32.0+) |

Roles marked with `?` are optional and can be enabled per-run or via config.

### Deterministic Guards

Guards are regex/pattern-based checks that run between coder and quality gates — no LLM cost, 100% deterministic:

| Guard | What it checks | Default |
|-------|---------------|---------|
| **output-guard** | Destructive operations (rm -rf, DROP TABLE, git push --force), exposed credentials (15 patterns: AWS keys, private keys, GitHub/npm/PyPI/Slack tokens, Google OAuth, JWTs, generic secrets), protected file modifications (.env, serviceAccountKey.json). All 15 credential patterns are blocking — secrets never pass (v1.38.2) | **On** (blocks on critical) |
| **perf-guard** | Frontend performance anti-patterns — images without dimensions/lazy, render-blocking scripts, missing font-display, document.write, heavy deps (moment, lodash, jquery) | **On** (advisory, configurable to block) |
| **intent-classifier** | Pre-triage keyword classification — skips LLM triage for obvious task types (doc, add-tests, refactor, infra, trivial-fix) | Off |
| **injection-guard** | Prompt injection scanner — detects directive overrides ("ignore previous instructions"), invisible Unicode characters (zero-width spaces, bidi overrides), and oversized comment block payloads in diffs before passing them to AI reviewers. Also available as a GitHub Action | **On** |

Guards are configurable via `kj.config.yml`:

```yaml
guards:
  output:
    enabled: true
    on_violation: block  # block | warn | skip
    # patterns: [{ id: "custom", pattern: "DANGEROUS", severity: "critical", message: "..." }]
    # protected_files: [secrets.yml]
  perf:
    enabled: true
    block_on_warning: false
    # patterns: [{ id: "custom-perf", pattern: "eval\\(", severity: "warning" }]
  intent:
    enabled: false
    confidence_threshold: 0.85
    # patterns: [{ keywords: ["readme", "docs"], taskType: "doc", confidence: 0.9 }]
```

## Pipeline Stage Tracker

During `kj_run`, Karajan emits a cumulative `pipeline:tracker` event after every stage transition. This gives MCP hosts (Claude Code, Codex, etc.) a single event with the full state of all stages:

```
  ┌ Pipeline
  │ ✓ triage → medium
  │ ✓ planner → 5 steps
  │ ▶ coder (claude/sonnet)
  │ · sonar
  │ · reviewer
  └
```

Status icons: `✓` done, `▶` running, `·` pending, `✗` failed.

Each stage includes an optional `summary` — the provider name while running, or a result summary when done.

For single-agent tools (`kj_code`, `kj_review`, `kj_plan`), tracker start/end logs are also emitted so hosts can show which agent is active.

## Solomon — Pipeline Boss (v1.11.0+, enhanced v1.25.0)

Solomon runs after each iteration as the Pipeline Boss & Arbiter. It evaluates every reviewer rejection, classifies issues as critical vs. style-only, and can override style-only blocks to keep the pipeline moving. 6 built-in rules:

| Rule | What it checks |
|------|---------------|
| `max_files_per_iteration` | Too many files changed in one iteration (default: 15) |
| `max_stale_iterations` | Same issues repeating across iterations (default: 3) |
| `dependency_guard` | New dependencies added without explicit approval |
| `scope_guard` | Changes outside the task's expected scope |
| `reviewer_overreach` | Reviewer blocking on files outside the diff scope (v1.12.0) |
| `style_only_block` | Reviewer blocking exclusively on style/formatting issues — auto-escalates to human review (v1.24.1) |

When a critical alert fires, Solomon pauses the session and asks for human input via `elicitInput`.

Since v1.12.0, Solomon also mediates reviewer stalls. Instead of immediately stopping the pipeline when the reviewer raises blocking issues, Solomon evaluates whether those issues are legitimate scope concerns or reviewer overreach, and acts accordingly.

Since v1.25.0, Solomon evaluates **every** reviewer rejection, classifying issues and applying smart iteration logic. Style-only blocks are overridden automatically, allowing the pipeline to continue without human intervention for subjective concerns.

## Reviewer Scope Filter (v1.12.0)

The scope filter automatically detects when a reviewer raises blocking issues about files that are not part of the current diff. Instead of stalling the pipeline, these out-of-scope issues are:

1. **Auto-deferred** — removed from the blocking issue list so the pipeline continues
2. **Tracked as tech debt** — stored in the session's `deferredIssues` field for later resolution
3. **Fed back to the coder** — deferred issues are included in the coder prompt on subsequent iterations, so the coder is aware of them without being blocked

This prevents a common failure mode where a reviewer flags pre-existing problems in untouched files, causing the pipeline to loop indefinitely on issues the coder cannot resolve within the current task's scope.

## Rate-Limit Standby (v1.11.0)

When a coder or reviewer hits a rate limit, Karajan:

1. Parses the cooldown time from the error message (5 patterns supported)
2. Waits with exponential backoff (default 5min, max 30min)
3. Emits `coder:standby`, `coder:standby_heartbeat` (every 30s), and `coder:standby_resume` events
4. Retries the same iteration automatically
5. After 5 consecutive standby retries, pauses for human intervention

## Preflight Handshake (v1.11.0)

Before `kj_run` or `kj_code` executes, Karajan requires a `kj_preflight` call to confirm the agent configuration. This prevents AI agents from silently overriding your coder/reviewer assignments.

The preflight supports natural language: `"use gemini as coder"`, `"coder: claude"`, or `"set reviewer to codex"`.

Session overrides are stored in-memory and die when the MCP server restarts.

## BecarIA Gateway (v1.13.0)

BecarIA Gateway adds full CI/CD integration with GitHub PRs as the single source of truth. Instead of running agents locally and manually creating PRs, the gateway makes PRs the central coordination point.

### How it works

1. **Early PR creation**: After the first coder iteration, Karajan creates a draft PR automatically
2. **Agent comments on PRs**: All agents (Coder, Reviewer, Sonar, Solomon, Tester, Security, Planner) post their results as PR comments or reviews
3. **Configurable dispatch events**: The `becaria` config section defines which GitHub Actions workflows to trigger at each pipeline stage
4. **Embedded workflow templates**: `kj init --scaffold-becaria` generates ready-to-use workflow files (`becaria-gateway.yml`, `automerge.yml`, `houston-override.yml`)

### Standalone review with PR diff

`kj review` now supports reviewing an existing PR's diff directly, making it usable as a standalone code review tool outside the full pipeline.

### Setup

```bash
kj init --scaffold-becaria
kj doctor  # verifies BecarIA configuration
```

Enable via CLI:

```bash
kj run --enable-becaria --task "Add input validation"
```

Or via MCP:

```json
{
  "tool": "kj_run",
  "params": {
    "task": "Add input validation",
    "enableBecaria": true
  }
}
```

`kj doctor` includes BecarIA-specific checks to verify that workflow templates are present and the GitHub token has the required permissions.

## Architect Stage (v1.17.0+)

The **architect** role runs between researcher and planner to define the solution architecture before coding begins. It produces explicit design decisions: layers, patterns, data model, API contracts, and tradeoffs.

### Activation

Triage auto-activates the architect when the task creates new modules/apps, affects data models or APIs, has medium/complex complexity, or has ambiguous design. You can also enable it explicitly:

```bash
kj run --enable-architect --task "Build user authentication system"
```

### Interactive clarification

When the architect detects design ambiguity, it returns `verdict: "needs_clarification"` with targeted questions. The pipeline pauses and asks the human via `askQuestion`. After receiving answers, the architect re-evaluates with the additional context.

If no interactive input is available (non-interactive CLI), the architect continues with best-effort decisions and emits a warning.

### Auto ADR generation

When a Planning Game card is linked (`pgTaskId` + `pgProject`), each architectural tradeoff is automatically persisted as an Architecture Decision Record (ADR) via the Planning Game MCP.

## Policy-Driven Pipeline (v1.14.0+)

The **policy-resolver** module maps each `taskType` to a set of pipeline policies, determining which stages are enabled or disabled:

| taskType | TDD | SonarQube | Reviewer | Tests Required |
|----------|-----|-----------|----------|----------------|
| `sw` | ✓ | ✓ | ✓ | ✓ |
| `infra` | ✗ | ✗ | ✓ | ✗ |
| `doc` | ✗ | ✗ | ✓ | ✗ |
| `add-tests` | ✗ | ✓ | ✓ | ✓ |
| `refactor` | ✓ | ✓ | ✓ | ✗ |

Unknown or missing `taskType` defaults to `sw` (most conservative).

Policies can be overridden per-project in `kj.config.yml`:

```yaml
policies:
  sw:
    tdd: false
  infra:
    sonar: true
```

The orchestrator emits a `policies:resolved` event and applies policy gates using shallow copies — never mutating the caller's configuration.

### Auto-Simplify Pipeline (v1.25.1+)

When triage classifies a task as level 1-2 (trivial or simple), the pipeline automatically runs a lightweight coder-only flow — reviewer, tester, and other post-coder stages are auto-disabled. Level 3+ tasks (medium, complex) get the full pipeline with all enabled stages. This reduces overhead for simple tasks while preserving rigor for complex ones.

Disable with `--no-auto-simplify` (CLI) or `autoSimplify: false` (MCP).

### Auto-Detect TDD (v1.25.0+)

TDD methodology is now auto-detected based on the project's test framework. If the project has a test runner configured (Vitest, Jest, Mocha, etc.), the pipeline automatically enables TDD without requiring `--methodology tdd`. You can still override with `--methodology standard` if needed.

Since v1.38.1, TDD supports **12 languages** beyond JavaScript/TypeScript: Java (JUnit/Maven/Gradle), Python (pytest/unittest), Go (go test), Rust (cargo test), C# (dotnet test/NUnit/xUnit), Ruby (RSpec/Minitest), PHP (PHPUnit), Swift (XCTest), Dart (dart test/Flutter), and Kotlin (JUnit/Gradle). The TDD enforcer auto-detects the project's language and test framework.

### Mandatory Triage (v1.15.0+)

Starting from v1.15.0, triage always runs to classify the task's `taskType`. The classification priority is:

1. Explicit `--taskType` flag (highest priority)
2. `taskType` in `kj.config.yml`
3. Triage AI classification
4. Default: `sw` (most conservative)

Triage can activate additional roles but cannot deactivate roles explicitly enabled in pipeline config.

## Discovery Stage (v1.16.0+)

The **discover** stage runs before triage as an opt-in pre-pipeline stage. It analyzes the task specification for gaps, ambiguities, and missing information before any code is written.

### Enabling discovery

Via CLI:
```bash
kj run --enable-discover --task "Add user authentication"
```

Via MCP:
```json
{
  "tool": "kj_run",
  "params": {
    "task": "Add user authentication",
    "enableDiscover": true
  }
}
```

Or permanently in `kj.config.yml`:
```yaml
pipeline:
  discover:
    enabled: true
    mode: gaps  # or: momtest, wendel, classify, jtbd
```

### 5 Discovery Modes

| Mode | What it does |
|------|-------------|
| `gaps` | Default — identifies missing requirements, ambiguities, implicit assumptions, and contradictions |
| `momtest` | Generates validation questions following The Mom Test principles (past behavior, not hypotheticals) |
| `wendel` | Evaluates 5 behavior change adoption conditions: CUE, REACTION, EVALUATION, ABILITY, TIMING |
| `classify` | Classifies task impact as START (new behavior), STOP (remove behavior), or DIFFERENT (change existing) |
| `jtbd` | Generates reinforced Jobs-to-be-Done with functional, emotional, and behavioral layers |

### Standalone usage with kj_discover

Discovery is also available as a standalone MCP tool:

```json
{
  "tool": "kj_discover",
  "params": {
    "task": "Add dark mode toggle to settings page",
    "mode": "wendel"
  }
}
```

### Non-blocking behavior

Discovery is non-blocking: if it fails, the pipeline logs a warning and continues execution. When verdict is `needs_validation`, the pipeline emits a warning with the detected gaps but proceeds normally.

## Integrated HU Manager (v1.38.0+)

When triage classifies a task as medium or complex, the **hu-reviewer** role auto-activates and decomposes the task into 2-5 formal user stories (HUs) with dependency ordering. Each HU then runs as its own iteration through the pipeline (coder → sonar → reviewer), with individual state tracking (pending → coding → reviewing → done/failed/blocked).

### How it works

1. **Triage classification**: triage analyzes the task and determines complexity level
2. **Auto-activation**: for medium/complex tasks, hu-reviewer activates automatically (no `--enable-hu-reviewer` needed)
3. **AI-driven decomposition**: hu-reviewer decomposes the task into 2-5 formal HUs with acceptance criteria and dependency graphs
4. **Sub-pipeline execution**: each HU runs its own coder → sonar → reviewer cycle with state tracking
5. **PG adapter**: when a Planning Game card is linked, card data is fed to hu-reviewer for richer context
6. **History records**: pipeline history records are generated for all task runs, providing full traceability

### Parallel HU execution (v1.46.0+)

Independent HUs (those without unresolved dependencies) run concurrently via git worktrees. Each HU gets its own worktree so coders can work in parallel without conflicting on the same working directory. Dependent HUs wait until their blockers complete before starting.

### State tracking

Each HU progresses through states independently:

```
pending → coding → reviewing → done
                             → failed
                             → blocked
```

The pipeline tracks which HUs are complete and which remain, ensuring dependencies are respected during execution.

### Manual override

You can still enable hu-reviewer explicitly for simple tasks:

```bash
kj run --enable-hu-reviewer --task "Add input validation"
```

Or disable the auto-activation:

```bash
kj run --no-hu-reviewer --task "Complex task without HU decomposition"
```
