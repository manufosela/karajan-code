---
title: Pipeline
description: How the Karajan Code multi-agent pipeline works.
---

:::note
This page is under construction. Full content coming soon.
:::

## Pipeline Overview

```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer → tester? → security? → commiter?
```

| Role | Description | Default |
|------|-------------|---------|
| **triage** | Pipeline director — analyzes task complexity and activates roles dynamically | **On** |
| **researcher** | Investigates codebase context before planning | Off |
| **planner** | Generates structured implementation plans | Off |
| **coder** | Writes code and tests following TDD | **Always on** |
| **refactorer** | Improves code clarity without changing behavior | Off |
| **sonar** | Runs SonarQube static analysis and quality gates | On (if configured) |
| **reviewer** | Code review with configurable strictness profiles | **Always on** |
| **tester** | Test quality gate and coverage verification | **On** |
| **security** | OWASP security audit | **On** |
| **solomon** | Session supervisor — monitors iteration health with 5 rules, mediates reviewer stalls, escalates on anomalies | **On** |
| **commiter** | Git commit, push, and PR automation after approval | Off |

Roles marked with `?` are optional and can be enabled per-run or via config.

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

## Solomon Supervisor (v1.11.0+)

Solomon runs after each iteration as a session supervisor with 5 built-in rules:

| Rule | What it checks |
|------|---------------|
| `max_files_per_iteration` | Too many files changed in one iteration (default: 15) |
| `max_stale_iterations` | Same issues repeating across iterations (default: 3) |
| `dependency_guard` | New dependencies added without explicit approval |
| `scope_guard` | Changes outside the task's expected scope |
| `reviewer_overreach` | Reviewer blocking on files outside the diff scope (v1.12.0) |

When a critical alert fires, Solomon pauses the session and asks for human input via `elicitInput`.

Since v1.12.0, Solomon also mediates reviewer stalls. Instead of immediately stopping the pipeline when the reviewer raises blocking issues, Solomon evaluates whether those issues are legitimate scope concerns or reviewer overreach, and acts accordingly.

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
