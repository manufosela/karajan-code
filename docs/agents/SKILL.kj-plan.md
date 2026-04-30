# SKILL: kj plan

## What it does

Manages **plans** — versioned JSON files that decompose a task into HUs
(atomic user stories) with dependencies and acceptance tests. Plans
live under `~/.kj/plans/<projectSlug>/plan-<id>.json`.

Subcommands: `generate`, `list`, `show`, `ready`, `validate`, `delete`,
`add-hu`, `remove-hu`.

## Inputs

### `kj plan generate [task]`

| Input | Form | Required |
|---|---|---|
| Task description | positional `[task]` | one of (positional, `--task-file`) |
| Task from file | `--task-file <path>` | one of |
| Skip prompt | `-y` / `--yes` | optional |
| Quick sketch (skip planner LLM passes) | `--quick` | optional |
| Skip tests-synth | `--no-tests-synth` | optional |
| Skip plan-review | `--no-plan-review` | optional |
| Override planner provider | `--planner <name>` | optional |
| Override planner model | `--planner-model <name>` | optional |
| Extra context | `--context <text>` | optional |
| JSON output | `--json` | optional |

### `kj plan show <planId>` / `validate <planId>` / `ready <planId>` / `delete <planId>`

Single positional `<planId>`.

### `kj plan list`

No args. Lists every plan under `~/.kj/plans/<projectSlug>/`.

## Outputs

### `kj plan generate`

- **stdout**: human-readable summary + planId + commands to inspect/run.
- **stdout (`--json`)**: full plan JSON.
- **disk**: `~/.kj/plans/<projectSlug>/plan-<timestamp>-<rand>.json`.
- **exit 0**: success.
- **exit non-zero**: planner failed (LLM error, agent unavailable),
  invalid SPEC, or write error.

### `kj plan show`, `validate`, `list`

stdout report; exit 0 on success, non-zero on missing plan / invalid
schema.

## Constraints

- Must run inside a git repo (the projectDir = cwd is stamped on the plan).
- Network: planner subcommand calls a real LLM. Other subcommands are read-only.
- Node ≥ 18.

## Side effects

- `generate`: writes `<plan-id>.json`. Auto-starts the HU Board (port 4000)
  unless `hu_board.enabled: false` in `kj.config.yml`.
- `ready`: mutates the plan's `status` field on disk (idempotent).
- `delete`: moves the plan to `~/.kj/plans/<slug>/_trash/` (recoverable).

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `No task provided. Pass a task argument or --task-file <path>.` | `generate` invoked without a task source | Add `--task-file SPEC.md` or `kj plan generate "do X"` |
| `Invalid API key` | Planner LLM auth failed | Check provider auth (`claude login`, etc.) |
| `plan not found: <id>` | typo'd planId on `show`/`validate`/`ready` | Run `kj plan list` to find the right id |
| `Acceptance test does not parse` (post #539) | Planner emitted invalid jq / shell — Canvas validator caught it | Edit the SPEC to make the test concrete |

## Example

```bash
# Generate a plan from a SPEC file
kj plan generate --task-file SPEC.md -y

# Inspect what was produced
kj plan list
kj plan show plan-20260429094214-0srv

# Mark approved + ready to run
kj plan ready plan-20260429094214-0srv

# Run it
kj run --plan plan-20260429094214-0srv -y
```

## Related

- `kj run --plan <id>` consumes plans. See [SKILL.kj-run.md](SKILL.kj-run.md).
- `kj audit` does NOT generate plans (read-only). See [SKILL.kj-audit.md](SKILL.kj-audit.md).
- Plan schema: [src/plan/plan-schema.js](../../src/plan/plan-schema.js).
