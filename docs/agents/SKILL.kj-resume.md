# SKILL: kj resume

## What it does

Resumes a **paused, stopped or failed** Karajan session by id.
Sessions are persisted under `~/.karajan/sessions/<sid>/`; each one
carries a `config_snapshot` so resumption preserves the original
flags (`--no-sonar`, `--coder`, etc.) — no need to remember what
the original `kj run` command looked like.

`kj run` itself auto-resumes recoverable failures up to
`session.max_auto_resumes` (default 2) before surfacing the error,
so manual `kj resume` is mostly for explicit pause-checkpoints.

## Inputs

| Input | Form | Required |
|---|---|---|
| Session id | positional `<sessionId>` | yes |
| Answer to a paused question | `--answer <text>` | optional, only for paused sessions |
| Project dir | `--project-dir <path>` | optional, when running outside the session's project |

## Outputs

- **stdout**: streaming pipeline log resuming from the stage that
  was active when the session paused/failed.
- **disk**: same set as `kj run` — commits, session metadata,
  HU batch state.
- **exit 0**: session reached a terminal state successfully.
- **exit non-zero**: same failure surfaces as `kj run`.

## Constraints

- The session id must exist under `~/.karajan/sessions/`.
- For paused sessions, the resume answer must satisfy the question's
  validation (e.g. \"yes / no\", a checkpoint decision).
- Will refuse to resume a session whose status is `done` or
  `cancelled`.

## Side effects

- Same as `kj run`: writes to the project, commits, optionally
  pushes / opens PRs depending on `git.auto_*` config.
- Updates the session's status under `~/.karajan/sessions/<sid>/`.

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `Session not found: <sid>` | Wrong id, or `~/.karajan` lives elsewhere | `ls ~/.karajan/sessions/`; set `KJ_HOME` if customised |
| `Session is in terminal state \"done\"` | Already finished | Start a new run instead |
| `Resume answer rejected: pattern mismatch` | Answer triggered the prompt-injection guard | Provide a plain factual answer (yes/no, file path) |
| `Auto-resume limit reached (2/2)` | The error keeps re-occurring | Inspect the underlying failure; clear it manually before resuming |

## Example

```bash
# List sessions
ls ~/.karajan/sessions/

# Resume a paused session by id
kj resume s_20260505101530_abcd

# Resume a paused checkpoint with an answer
kj resume s_20260505101530_abcd --answer "yes"
```

## Related

- [SKILL.kj-run.md](SKILL.kj-run.md) — what created the session.
- `kj report --session <sid>` — inspect what happened before the
  pause/failure.
