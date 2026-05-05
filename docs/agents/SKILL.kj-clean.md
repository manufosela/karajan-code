# SKILL: kj clean

## What it does

Garbage-collects stale plans, sessions, HU batches and audit/review
outputs under `~/.karajan/`. Honors per-category retention windows
configured in `~/.karajan/kj.config.yml`. Defaults are conservative
(7 days for sessions, 30 days for plans).

Use this when `~/.karajan/` has grown beyond what you want, or when
debugging a clean-slate test scenario.

## Inputs

| Input | Form | Required |
|---|---|---|
| Dry run (preview only) | `--dry-run` | optional |
| Override retention window | `--retention <days>` | optional, applies to all categories |
| Wipe everything (zero retention + nuke board DB) | `--nuke` | optional, **destructive** |
| Auto-confirm | `--yes` / `-y` | optional |

## Outputs

- **stdout**: per-category summary — count + total size freed.
- **disk**: removes:
  - `~/.karajan/sessions/<sid>/` older than retention.
  - `~/.karajan/plans/plan-*.json` older than retention.
  - `~/.karajan/hu-stories/<batchSessionId>/` older than retention.
  - `~/.karajan/audits/`, `~/.karajan/reviews/` outputs older than retention.
  - `~/.karajan/hu-board/db.sqlite` (only with `--nuke`).
- **exit 0**: cleanup ran (regardless of how many entries were removed).
- **exit non-zero**: filesystem error.

## Constraints

- Will NEVER touch your project repository or `kj.config.yml`.
- `--nuke` is destructive: deletes the HU Board SQLite DB.
- Will refuse `--nuke` without `--yes` in a TTY (safety prompt).

## Side effects

- Deletes files. The deletion is permanent (no trash).
- A running HU Board daemon may need to be restarted after `--nuke`
  because the DB it had open just disappeared.

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `EBUSY ~/.karajan/hu-board/db.sqlite` (`--nuke`) | Board daemon has the file open | `kj board stop`; rerun |
| `Refusing --nuke without --yes` | Safety check | Add `-y` if you mean it |
| `Permission denied` | File mode | `chown -R $USER ~/.karajan` |

## Example

```bash
# Preview what would be removed
kj clean --dry-run

# Aggressive cleanup (everything older than 1 day)
kj clean --retention 1 -y

# Total reset (board DB included)
kj board stop && kj clean --nuke -y
```

## Related

- [SKILL.kj-resume.md](SKILL.kj-resume.md) — sessions you've cleaned can no longer be resumed.
- [SKILL.kj-board.md](SKILL.kj-board.md) — `--nuke` wipes its DB; restart after.
