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
| **solomon** | Session supervisor — monitors iteration health with 4 rules, escalates on anomalies | **On** |
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

## Solomon Supervisor (v1.11.0)

Solomon runs after each iteration as a session supervisor with 4 built-in rules:

| Rule | What it checks |
|------|---------------|
| `max_files_per_iteration` | Too many files changed in one iteration (default: 15) |
| `max_stale_iterations` | Same issues repeating across iterations (default: 3) |
| `dependency_guard` | New dependencies added without explicit approval |
| `scope_guard` | Changes outside the task's expected scope |

When a critical alert fires, Solomon pauses the session and asks for human input via `elicitInput`.

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
