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
| **triage** | Classifies task complexity and activates necessary roles | Off |
| **researcher** | Investigates codebase context before planning | Off |
| **planner** | Generates structured implementation plans | Off |
| **coder** | Writes code and tests following TDD | **Always on** |
| **refactorer** | Improves code clarity without changing behavior | Off |
| **sonar** | Runs SonarQube static analysis and quality gates | On (if configured) |
| **reviewer** | Code review with configurable strictness profiles | **Always on** |
| **tester** | Test quality gate and coverage verification | Off |
| **security** | OWASP security audit | Off |
| **solomon** | Conflict resolver when coder and reviewer disagree | Off |
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
