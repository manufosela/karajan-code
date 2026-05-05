# SKILL: kj review

## What it does

Runs the **reviewer role only** against the current diff (uncommitted
changes by default; against a base ref if requested). Useful for
\"second-opinion\" passes when you wrote code by hand and want
Karajan's reviewer to weigh in without going through the full
coder/iterate cycle.

## Inputs

| Input | Form | Required |
|---|---|---|
| Override reviewer agent | `--reviewer <provider>` | optional |
| Reviewer model | `--reviewer-model <name>` | optional |
| Base ref | `--base-ref <ref>` (default: working tree vs HEAD) | optional |
| Mode | `--mode strict|standard|loose` | optional |
| JSON output | `--json` | optional |

## Outputs

- **stdout**: per-file findings (severity, file:line, suggestion) +
  final verdict (`approve` / `request_changes`).
- **stdout (`--json`)**: `{ findings: [...], verdict, summary }`.
- **disk**: review report at `~/.karajan/reviews/<timestamp>.md` if
  `reviews.persist: true` in config.
- **exit 0**: verdict is `approve` (or `request_changes` with
  warnings only).
- **exit non-zero**: blocking findings present (configurable threshold).

## Constraints

- Read-only on the project. Never modifies files.
- Requires the reviewer agent CLI to be installed and authenticated.
- Diff is computed via `git diff` — must be inside a git repo.

## Side effects

- One LLM call to the reviewer provider (token cost surfaced in
  stdout).
- Optional disk write under `~/.karajan/reviews/`.

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `No diff to review` | Working tree clean and no `--base-ref` | Stage changes first, or pass `--base-ref main` |
| `Reviewer failed: 403 ...` | Reviewer LLM auth expired | Re-login (e.g. `claude login`, `codex login`) |
| `Diff too large (> N tokens)` | Massive PR | Split the change, or pass `--base-ref` to a closer ancestor |

## Example

```bash
# Quick review of uncommitted work
kj review

# Compare current branch against main
kj review --base-ref main

# Strict mode + JSON for CI
kj review --mode strict --json > review.json
```

## Related

- [SKILL.kj-run.md](SKILL.kj-run.md) — full pipeline (coder + reviewer + tester + …).
- [SKILL.kj-audit.md](SKILL.kj-audit.md) — static analysis instead of LLM-based review.
