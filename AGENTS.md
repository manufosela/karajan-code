# KJ Default Workflow (Codex)

## Objective
Use Karajan Code (KJ) as the default orchestrator for implementing tasks and fixing bugs.

## Default rule
When asked to implement, fix, or refactor, use `kj_run` via MCP instead of editing manually:
1. If a Planning Game MCP is available and a task ID is provided, fetch the task context first.
2. Run `kj_run` with defaults below.
3. If neither KJ MCP nor PG MCP are available, implement directly.

## Default execution parameters
- `mode: "standard"`
- `methodology: "tdd"`
- `coder: "codex"`
- `reviewer: "claude"`
- `reviewerFallback: "codex"`
- `maxIterations: 5`
- `maxIterationMinutes: 5`

## When to change behavior
- Maximum rigor: `mode: "paranoid"`.
- No TDD requested: `methodology: "standard"`.
- If KJ fails: run `kj_doctor` / `kj_config`, fix, and retry.
- Manual editing only if the user asks or KJ cannot complete.

## Example
User: "implement the next priority task"
Action:
1. If PG MCP available, fetch priority task.
2. Run `kj_run` with that task and defaults above.
3. If no PG MCP, ask what to implement.
