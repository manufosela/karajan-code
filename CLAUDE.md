# KJ Default Workflow (Claude Code)

## Objective
Use Karajan Code (KJ) as the default orchestrator for implementing tasks and fixing bugs in this project.

## Default rule
When asked to implement, fix, or refactor code, use `kj_run` via MCP instead of editing manually:
1. If a Planning Game MCP is available and a task ID is provided, fetch the task context first.
2. Run `kj_run` with the task description and defaults below.
3. If neither KJ MCP nor PG MCP are available, implement directly.

## Default execution parameters
For `kj_run`, use:
- `mode: "standard"`
- `methodology: "tdd"`
- `coder: "claude"`
- `reviewer: "codex"`
- `reviewerFallback: "claude"`
- `maxIterations: 5`
- `maxIterationMinutes: 5`

## When to change behavior
- Maximum rigor requested: use `mode: "paranoid"`.
- User explicitly requests no TDD: use `methodology: "standard"`.
- If `kj_run` fails, diagnose with `kj_doctor` / `kj_config` and retry.
- Edit manually only if the user asks or KJ cannot complete the task.

## PR atomicity (hard project rule)
This repo enforces a CI gate that fails any PR whose net delta exceeds **200 lines added** (`shrink-budget` workflow, since 2026-05-08). Both for `kj_run` and for direct edits:
- Aim for **~150 LOC per PR** (margin against the 200 hard limit).
- The gate counts the SUM of every changed source file. Tests count.
- **Human-facing docs are excluded** — `docs/**/*.md`, `docs/**/*.mdx`, `CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATION*.md`, `TODO*.md`. A 10 000-line README is fine; a 500-line refactor is not.
- **AI-rule files DO count** — `CLAUDE.md`, `AGENTS.md`, `templates/**/*.md` (role prompts, coder rules, review rules). Those go into the agent's context every run, so the same ≤200 LOC discipline applies — bloating them dilutes the signal the AI receives.
- Other exclusions: lockfiles, snapshots, `dist/`, `node_modules/`, `tests/_diet/`, `public/docs/`.
- If a task clearly needs >150 LOC, **partition it upfront** (multiple PRs, multiple HUs, multiple commits). Don't ship a single 500-LOC PR — the gate rejects it, the work gets redone, tokens burn twice.
- Escape hatch: `large-pr-justified` label on the PR, but use it sparingly and justify in the PR body.

## Troubleshooting and subprocess architecture

See `docs/troubleshooting.md` for common issues. Key points:

- **Claude as subprocess**: Claude Code 2.x requires 3 workarounds when launching `claude -p` from Node.js: strip `CLAUDECODE` env var, `stdin: "ignore"`, read from stderr (not stdout). See `src/agents/claude-agent.js` -> `cleanExecaOpts()` / `pickOutput()`.
- **Interactive wizards**: The coder runs without stdin. Tasks requiring `pnpm create astro`, `npm init`, etc. must use `--yes`/`--no-input` flags or report that they cannot complete.
- **Checkpoint**: If `elicitInput` returns null, the session continues (does not stop). Only explicit "stop" or "4" stops it.
- **Resume**: `kj_resume` accepts stopped, failed, and paused sessions.

## Example
User input: "implement the next priority task"
Expected action:
1. If PG MCP is available, fetch the priority task.
2. Run `kj_run` with that task and defaults above.
3. If no PG MCP, ask the user what to implement.
