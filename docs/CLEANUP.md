# Karajan cleanup — `kj clean`

`kj clean` is a **read-only by default** garbage collector that surfaces
stale state accumulated by Karajan so the user can decide what to drop.
It never executes destructive commands on its own — every layer prints a
copy-paste command you can run if you want to actually delete.

## At a glance

```bash
# Default: dry-run Karajan-internal state (plans, sessions, HU batches)
kj clean

# Add repo-level candidates (merged branches, dist/, *.tmp, *.bak)
kj clean --repo

# Add RAG vector-store orphans (~/.karajan/rag.db rows whose project_slug
# no longer maps to a live directory)
kj clean --vector-stores

# Everything in one pass
kj clean --all

# Actually delete the Karajan-internal entries listed above
kj clean --yes

# "I want it all gone right now": retention=0 + wipe HU board DB
kj clean --nuke --yes
```

## What each layer reports

### Internal state (always on)

Drives `~/.kj/plans/`, `~/.karajan/sessions/`, HU story batches.

| Bucket   | Default retention |
|----------|-------------------|
| Plans    | 30 days           |
| Drafts   | 60 days           |
| Sessions | 7 days            |
| HU batches | 14 days         |

Override with `--plan-days`, `--draft-days`, `--session-days`,
`--hu-days`. Dry-run prints what would go; `--yes` actually deletes.

### `--repo` — repo-level artifacts

Reports candidates inside the current `git` checkout:

- **Merged branches** into `origin/main` (or `--repo-base <ref>`).
- **Gone upstream** branches (`[gone]` in `git branch -vv`).
- Top-level `dist/`, `coverage/`, `logs/` older than `--repo-days`
  (default 7d).
- Top-level `*.tmp`, `*.bak` older than `--repo-days`.

Every candidate is printed with the **exact command to delete it**
(`git branch -d`, `rm -rf …`). Karajan does not run them.

### `--vector-stores` — RAG orphans

Enumerates `project_slug`s indexed in `~/.karajan/rag.db` and marks as
**orphan** any slug whose basename does not resolve to a live directory
under the known project roots (`~/ws_npm-packages`, `~/ws_firebase`,
`~/projects`, `~/code`). Override the scan with `--project-roots
<a:b:c>` (colon-separated, like `PATH`).

For each orphan, Karajan prints a copy-paste `sqlite3 … DELETE FROM
chunks WHERE project_slug='…'` command. Run it yourself if you want to
purge.

### `--all`

Shortcut for `--repo --vector-stores`. Useful before a release, or once
a quarter when you want a single audit pass.

## Safety guarantees

- **Read-only by default.** The internal-state layer requires `--yes` to
  delete; `--repo` and `--vector-stores` *never* delete — they only
  print commands.
- **No automatic destructive ops.** No `git branch -D`, no `rm -rf`, no
  raw `DELETE FROM …` are issued by `kj clean`.
- **Errors are non-blocking.** Per-stage errors are listed at the end;
  the rest of the report still prints.

## Companion: `kj board cleanup`

For the HU Board database (`.karajan/board.db`), use `kj board cleanup`
— a separate, board-aware pass that handles tombstones, orphan HUs and
restart-detector state. `kj clean --nuke --yes` also wipes the board DB
as part of the "everything gone" mode.

## Related issues

- [KJC-TSK-0499] — original umbrella task for `kj cleaner`.
- [KJC-PRP-0099] — Planning Game proposal that motivated the design
  (dry-run-first, explicit user opt-in for actual deletes).
