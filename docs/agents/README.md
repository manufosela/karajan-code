# Karajan Code — Agent-Facing Index

This directory is the AI-agent entry point for the Karajan Code repository.
Humans look at the top-level [README.md](../../README.md). Agents (Cursor,
Cline, Aider, generic Claude / Codex sessions) come here.

## How to consume this repo in one fetch

1. Fetch [llms.txt](../../llms.txt) — single file mapping every doc + CLI
   capability with token-count hints.
2. Fetch the `SKILL.<command>.md` for whichever command you need to invoke.
3. (Optional) Read [ARCHITECTURE.md](../ARCHITECTURE.md) for the pipeline.

## SKILL files (one per CLI command)

Each SKILL.md describes inputs, outputs, side effects, common failure
modes, and a runnable example for one `kj` command.

| Command | SKILL file | Purpose |
|---|---|---|
| `kj plan` | [SKILL.kj-plan.md](SKILL.kj-plan.md) | Generate / list / show / approve plans |
| `kj run` | [SKILL.kj-run.md](SKILL.kj-run.md) | Execute a plan or a one-shot task |
| `kj audit` | [SKILL.kj-audit.md](SKILL.kj-audit.md) | Read-only repo analysis |
| `kj doctor` | (TBD) | Environment checks + auto-remediation |
| `kj init` | (TBD) | Bootstrap config + rules + SonarQube |
| `kj board` | (TBD) | Web UI for plans + sessions |
| `kj review` | (TBD) | Reviewer-only against current diff |
| `kj resume` | (TBD) | Resume a paused / stopped session |
| `kj clean` | (TBD) | GC stale plans / sessions / batches |

(TBD) entries: contract is `kj <cmd> --help`. SKILL.md will be added
incrementally — see issue #541 follow-ups.

## Conventions for agents

- `kj <group> <action>` — never `kj <action> <group>`. The CLI guard
  surfaces the correct form when typo'd.
- Use `-y` to skip cwd confirmation in non-interactive contexts.
- `kj run --plan <id>` reuses the plan's stored task; you don't need
  `--task-file` again.

## Coverage guard

`tests/architecture/agent-docs-coverage.test.js` (TBD, follow-up)
asserts every kj subcommand has a matching SKILL.md. CI fails when
a new subcommand is added without documenting it.
