---
root: true
targets: ["*"]
description: "Karajan Code unified rules and workflow"
globs: ["**/*"]
---

# Karajan Code

Local multi-agent coding orchestrator. TDD-first, MCP-based, vanilla JavaScript.

## Core Mandates

- **Orchestrator First**: Always prefer using the `kj_run` tool via MCP for implementing changes.
- **TDD Compliance**: Ensure tests are written or updated alongside implementation.
- **Architectural Integrity**: Maintain the vanilla JS and MCP-centric architecture.
- **Subprocess Safety**: Remember that agents run as subprocesses without stdin.

## Code Style

- **Vanilla JavaScript**: Use modern ES modules (ESM). No TypeScript, no build step for the core.
- **Documentation**: Use JSDoc for complex functions. Keep `README.md` and `AGENTS.md` updated.
- **Consistency**: Follow the existing pattern of delegating to specialized roles (coder, reviewer, triage, etc.).

## Contribution Rules

- All changes must be verified with `npm test`.
- New features should include unit tests in the `tests/` directory.
- Follow the Clean Architecture principles established in the project.

# KJ Default Workflow

## Objective
Use Karajan Code (KJ) as the default orchestrator for implementing tasks, refactoring code, and fixing bugs in this project. KJ provides a repeatable pipeline with TDD, SonarQube integration, and multi-agent review.

## Default Rule
When asked to implement, fix, or refactor code, use `kj_run` via MCP instead of editing files manually:

1. **Task Context**: If a Planning Game (PG) MCP is available and a task ID is provided, fetch the task context first using the appropriate tool.
2. **Orchestration**: Execute `kj_run` with the task description and the default parameters listed below.
3. **Manual Fallback**: Only implement changes directly if KJ MCP is unavailable, if the task is strictly outside KJ's scope (e.g., pure documentation without code), or if KJ explicitly fails and manual intervention is requested.

## Default Execution Parameters
For `kj_run`, use these defaults unless the user specifies otherwise:
- `mode: "standard"`
- `methodology: "tdd"`
- `maxIterations: 5`
- `maxIterationMinutes: 5`

## Agent Selection Strategy
KJ supports multiple providers. By default, use the agent that matches your current identity for the `coder` role:
- If you are **Claude Code**: `coder: "claude"`, `reviewer: "gemini"`.
- If you are **Gemini CLI**: `coder: "gemini"`, `reviewer: "claude"`.
- If you are **Codex**: `coder: "codex"`, `reviewer: "claude"`.

## When to Change Behavior
- **Maximum Rigor**: If the user asks for high quality or critical safety, use `mode: "paranoid"`.
- **No TDD**: If the user explicitly asks to skip tests, use `methodology: "standard"`.
- **Diagnosis**: If `kj_run` fails, use `kj_doctor` or `kj_config` to diagnose the environment before retrying.

## Subprocess and Interaction Notes
- **Non-interactive**: KJ runs the coder as a subprocess without stdin. Tools requiring interactive input (e.g., `npm init`) must be run with silent/yes flags or reported as unfinishable.
- **Resuming**: Use `kj_resume` to continue sessions that are stopped, failed, or paused.
- **Monitoring**: The user can monitor real-time progress by running `kj-tail` in a separate terminal.
