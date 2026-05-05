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
| `kj doctor` | [SKILL.kj-doctor.md](SKILL.kj-doctor.md) | Environment checks + auto-remediation |
| `kj init` | [SKILL.kj-init.md](SKILL.kj-init.md) | Bootstrap config + rules + SonarQube |
| `kj board` | [SKILL.kj-board.md](SKILL.kj-board.md) | Web UI for plans + sessions |
| `kj review` | [SKILL.kj-review.md](SKILL.kj-review.md) | Reviewer-only against current diff |
| `kj resume` | [SKILL.kj-resume.md](SKILL.kj-resume.md) | Resume a paused / stopped session |
| `kj clean` | [SKILL.kj-clean.md](SKILL.kj-clean.md) | GC stale plans / sessions / batches |

Other commands not (yet) covered by a dedicated SKILL.md — `kj code`,
`kj scan`, `kj status`, `kj report`, `kj triage`, `kj discover`,
`kj researcher`, `kj architect`, `kj agents`, `kj roles`,
`kj skills`, `kj config`, `kj webperf`, `kj sync`, `kj undo` — fall
back to `kj <cmd> --help`. They're either thin wrappers around an
agent role (no novel inputs) or under iteration; SKILL.md will land
when their surface stabilises.

## Conventions for agents

- `kj <group> <action>` — never `kj <action> <group>`. The CLI guard
  surfaces the correct form when typo'd.
- Use `-y` to skip cwd confirmation in non-interactive contexts.
- `kj run --plan <id>` reuses the plan's stored task; you don't need
  `--task-file` again.

## Coverage guard

[`tests/architecture/agent-readability.test.js`](../../tests/architecture/agent-readability.test.js)
asserts every SKILL.md link in `llms.txt` resolves to a real file
under `docs/agents/`, and that every SKILL.md has the four
contract sections (`What it does`, `Inputs`, `Outputs`, `Example`).
CI fails when those rot.
