---
title: MCP Tools Reference
description: Complete parameter reference for all 21 Karajan Code MCP tools.
---

## kj_run

Run the full coder &rarr; sonar &rarr; reviewer pipeline with real-time progress notifications.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | **Yes** | — | Task description |
| `coder` | string | No | From config | AI agent for code generation |
| `coderModel` | string | No | `null` | Specific model for coder |
| `reviewer` | string | No | From config | AI agent for code review |
| `reviewerModel` | string | No | `null` | Specific model for reviewer |
| `reviewerFallback` | string | No | From config | Fallback reviewer if primary fails |
| `reviewerRetries` | number | No | `1` | Max review retries on parse error |
| `planner` | string | No | `null` | AI agent for planning |
| `plannerModel` | string | No | `null` | Specific model for planner |
| `refactorer` | string | No | `null` | AI agent for refactoring |
| `refactorerModel` | string | No | `null` | Specific model for refactorer |
| `mode` | string | No | `standard` | Review mode: `paranoid` \| `strict` \| `standard` \| `relaxed` |
| `methodology` | string | No | `tdd` | Development methodology: `tdd` \| `standard` |
| `maxIterations` | number | No | `5` | Max coder/reviewer loop iterations |
| `maxIterationMinutes` | number | No | `5` | Timeout per iteration (minutes) |
| `maxTotalMinutes` | number | No | From config | Total session timeout (minutes) |
| `baseBranch` | string | No | `main` | Git base branch for diffs |
| `baseRef` | string | No | `null` | Explicit base git ref for diff |
| `branchPrefix` | string | No | `feat/` | Git branch prefix |
| `enablePlanner` | boolean | No | `false` | Enable planning role |
| `enableReviewer` | boolean | No | `true` | Enable review role |
| `enableRefactorer` | boolean | No | `false` | Enable refactoring role |
| `enableResearcher` | boolean | No | `false` | Enable research role |
| `enableTester` | boolean | No | `false` | Enable test quality audit |
| `enableSecurity` | boolean | No | `false` | Enable OWASP security audit |
| `enableTriage` | boolean | No | `false` | Enable task complexity triage |
| `enableSerena` | boolean | No | `false` | Enable Serena semantic analysis |
| `autoCommit` | boolean | No | `false` | Auto-commit after approval |
| `autoPush` | boolean | No | `false` | Auto-push after commit |
| `autoPr` | boolean | No | `false` | Create PR after push |
| `autoRebase` | boolean | No | `true` | Rebase on base branch before push |
| `noSonar` | boolean | No | `false` | Skip SonarQube analysis |
| `pgTask` | string | No | `null` | Planning Game card ID (e.g., `PRJ-TSK-0042`) |
| `pgProject` | string | No | `null` | Planning Game project ID |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |
| `sonarToken` | string | No | From config | Override SonarQube token |
| `enableImpeccable` | boolean | No | `false` | Enable Impeccable design audit (automated UI/UX quality gate) |
| `enableHuReviewer` | boolean | No | `false` | Enable HU story certification (user story quality gate). Auto-activated by triage for medium/complex tasks since v1.38.0 |
| `huFile` | string | No | `null` | Path to user story file for HU reviewer. Optional — when auto-activated by triage, hu-reviewer works without a file |
| `taskType` | string | No | `null` | Task type for policy resolution: `sw`, `infra`, `doc`, `add-tests`, `refactor` |
| `autoSimplify` | boolean | No | `true` | Auto-simplify pipeline for triage level 1-2 (coder-only, skip reviewer/tester). Set to `false` to always run the full pipeline |
| `timeoutMs` | number | No | `null` | Command timeout in milliseconds (legacy; prefer heartbeat/stall telemetry and session silence guardrails) |

---

## kj_code

Run coder-only mode — skip the review loop. Useful for quick changes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | **Yes** | — | Task description |
| `coder` | string | No | From config | AI agent for coding |
| `coderModel` | string | No | `null` | Specific model for coder |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |
| `timeoutMs` | number | No | `null` | Command timeout in milliseconds (legacy; prefer heartbeat/stall telemetry and session silence guardrails) |

---

## kj_review

Run reviewer-only mode against the current diff. Useful after manual changes.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | **Yes** | — | Review task description |
| `reviewer` | string | No | From config | AI agent for review |
| `reviewerModel` | string | No | `null` | Specific model for reviewer |
| `baseRef` | string | No | `null` | Base ref for diff comparison |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |
| `timeoutMs` | number | No | `null` | Command timeout in milliseconds (legacy; prefer heartbeat/stall telemetry and session silence guardrails) |

---

## kj_plan

Generate an implementation plan without writing code, with heartbeat/stall telemetry and clearer diagnostics for long runs.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | **Yes** | — | Task description |
| `planner` | string | No | From config | AI agent for planning |
| `plannerModel` | string | No | `null` | Specific model for planner |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |
| `timeoutMs` | number | No | `null` | Command timeout in milliseconds (legacy; prefer heartbeat/stall telemetry and session silence guardrails) |

---

## kj_resume

Resume a paused session (e.g., after fail-fast or clarification question).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `sessionId` | string | **Yes** | — | Session ID to resume (e.g., `s_2026-02-28T20-47-24-270Z`) |
| `answer` | string | No | `null` | Answer to the question that caused the pause |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |

---

## kj_report

Read and display session reports with budget tracking.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `list` | boolean | No | `false` | List all session IDs instead of showing the latest |
| `sessionId` | string | No | Latest | Specific session ID to read |
| `format` | string | No | `text` | Output format: `text` \| `json` |
| `trace` | boolean | No | `false` | Show stage-by-stage breakdown with timing and costs |
| `currency` | string | No | `usd` | Cost display currency: `usd` \| `eur` |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |

---

## kj_scan

Run SonarQube scan on the current project.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |
| `sonarToken` | string | No | From config | Override SonarQube token |
| `timeoutMs` | number | No | `null` | Command timeout in milliseconds (legacy; prefer heartbeat/stall telemetry and session silence guardrails) |

---

## kj_init

Initialize karajan-code configuration, review rules, and SonarQube setup.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `kjHome` | string | No | `~/.karajan` | Custom KJ_HOME directory |
| `timeoutMs` | number | No | `null` | Command timeout in milliseconds (legacy; prefer heartbeat/stall telemetry and session silence guardrails) |

---

## kj_doctor

Check system dependencies and agent CLIs (claude, codex, gemini, aider).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |
| `timeoutMs` | number | No | `null` | Command timeout in milliseconds (legacy; prefer heartbeat/stall telemetry and session silence guardrails) |

---

## kj_config

Show current configuration (pretty-print or JSON).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `json` | boolean | No | `false` | Output as JSON instead of pretty-print |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |

---

## kj_roles

List pipeline roles or show a specific role template.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | No | `list` | Action: `list` \| `show` |
| `roleName` | string | No | `null` | Role to inspect (e.g., `coder`, `reviewer`, `reviewer-paranoid`) |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |

---

## kj_agents

List or change AI agent assignments per role. Supports session, project, and global scope.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | No | `list` | Action: `list` \| `set` |
| `role` | string | No | `null` | Role to change (e.g., `coder`, `reviewer`) — required for `set` |
| `provider` | string | No | `null` | Provider to assign (e.g., `claude`, `codex`) — required for `set` |

---

## kj_preflight

Human confirms agent configuration before `kj_run`/`kj_code` executes. Required before first run in each MCP session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `humanResponse` | string | **Yes** | — | Human's response: `"ok"` to confirm, or natural language to adjust (e.g., `"use gemini as coder"`) |
| `coder` | string | No | `null` | Override coder agent |
| `reviewer` | string | No | `null` | Override reviewer agent |
| `tester` | string | No | `null` | Override tester agent |
| `security` | string | No | `null` | Override security agent |
| `solomon` | string | No | `null` | Override solomon agent |
| `enableTester` | boolean | No | `null` | Enable/disable tester role |
| `enableSecurity` | boolean | No | `null` | Enable/disable security role |

---

## kj_status

Show real-time status and log of the current or last Karajan run. Returns a parsed status summary (current stage, agent, iteration, errors) plus recent log lines.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `lines` | number | No | `50` | Number of log lines to show |

**Response includes:**
- `status.currentStage` — which stage is currently running
- `status.currentAgent` — which AI agent is active
- `status.iteration` — current iteration number
- `status.isRunning` — whether a run is in progress
- `status.errors` — last 3 error lines

---

## kj_audit

Read-only codebase health audit across 5 dimensions: security, code quality, performance, architecture, and testing. Generates a structured report with A-F scores and prioritized recommendations without modifying any files.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | No | `null` | Optional focus area or specific concern to audit |
| `projectDir` | string | No | cwd | Project directory to audit |
| `kjHome` | string | No | `~/.karajan` | Override KJ_HOME directory |

---

## kj_discover

Run discovery analysis on a task using multiple analytical frameworks (gaps, Mom Test, Wendel, JTBD).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | **Yes** | — | Task description to analyze |
| `mode` | string | No | `gaps` | Discovery mode: `gaps` \| `momtest` \| `wendel` \| `classify` \| `jtbd` |
| `projectDir` | string | No | cwd | Project directory |

**Example:**

```json
{
  "tool": "kj_discover",
  "params": {
    "task": "Add multi-tenancy support",
    "mode": "jtbd"
  }
}
```

---

## kj_triage

Classify task complexity and determine which pipeline roles should be activated.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | **Yes** | — | Task description to classify |
| `projectDir` | string | No | cwd | Project directory |

**Example:**

```json
{
  "tool": "kj_triage",
  "params": {
    "task": "Fix typo in the README"
  }
}
```

---

## kj_researcher

Investigate codebase context relevant to a task before planning or coding.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | **Yes** | — | Task description to research |
| `projectDir` | string | No | cwd | Project directory |

**Example:**

```json
{
  "tool": "kj_researcher",
  "params": {
    "task": "Refactor the authentication module"
  }
}
```

---

## kj_architect

Design solution architecture for a task, producing a structured design document.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | **Yes** | — | Task description to architect |
| `projectDir` | string | No | cwd | Project directory |

**Example:**

```json
{
  "tool": "kj_architect",
  "params": {
    "task": "Migrate from REST to GraphQL"
  }
}
```

---

## kj_board

Start, stop, or check the status of the HU Board dashboard.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | **Yes** | — | Action: `start` \| `stop` \| `status` |
| `projectDir` | string | No | cwd | Project directory |

**Example:**

```json
{
  "tool": "kj_board",
  "params": {
    "action": "start"
  }
}
```

---

## kj_hu

Manage user stories (create, update, list, get) in the local HU Board.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | **Yes** | — | Action: `create` \| `update` \| `list` \| `get` |
| `title` | string | No | `null` | User story title (required for `create`) |
| `description` | string | No | `null` | User story description |
| `huId` | string | No | `null` | HU identifier (required for `update` and `get`) |
| `status` | string | No | `null` | HU status |
| `projectDir` | string | No | cwd | Project directory |

**Example:**

```json
{
  "tool": "kj_hu",
  "params": {
    "action": "create",
    "title": "As a user I want to reset my password",
    "description": "Password reset flow with email verification"
  }
}
```

---

## Common response format

All tools return a structured response:

**Success:**
```json
{
  "ok": true,
  "sessionId": "s_...",
  ...
}
```

**Error:**
```json
{
  "ok": false,
  "error": "Error message",
  "tool": "kj_run",
  "category": "sonar_unavailable",
  "suggestion": "Actionable fix suggestion"
}
```

Error categories: `sonar_unavailable`, `auth_error`, `config_error`, `agent_missing`, `timeout`, `branch_error`, `agent_stall`, `git_error`, `unknown`.
