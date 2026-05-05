# SKILL: kj board

## What it does

Manages the **HU Board** — a local web dashboard (Express + SQLite)
that visualises plans, HU statuses, sessions and the run timeline.
It auto-starts when `kj plan` produces a batch and can be used standalone.

Subcommands: `start` | `stop` | `status` | `open`.

## Inputs

| Input | Form | Required |
|---|---|---|
| Action | positional `start` / `stop` / `status` / `open` (default `start`) | optional |
| Port | `--port <n>` (default 4000, fallback 4001-4009 if busy) | optional |
| Bind host | `--bind <host>` (default 127.0.0.1; use `0.0.0.0` for LAN) | optional |

## Outputs

- **stdout**: a small framed banner — PID, URL, status, project name when applicable.
- **disk**:
  - `~/.karajan/hu-board.pid` — PID file the CLI uses to track the daemon.
  - `~/.karajan/hu-board/token` — auto-generated bearer token (mode 0600);
    only enforced for non-loopback peers.
  - SQLite database at `~/.karajan/hu-board/db.sqlite` (created by the daemon).
- **HTTP server**: listens on `${bind}:${port}` (default `127.0.0.1:4000`).
- **exit 0**: action completed; for `start`, the daemon is detached and
  running in the background.
- **exit non-zero**: port unavailable in fallback range, or PID file
  pointed at a process that resists SIGTERM.

## Constraints

- Default bind is **loopback only**. `--bind 0.0.0.0` exposes on LAN
  and auto-enforces token auth for non-loopback peers.
- One daemon per machine: a second `kj board start` re-uses the existing
  one (PID file + HTTP probe).
- The daemon detaches via `child.unref()` and survives the parent shell.

## Side effects

- Starts a long-running Node process (`packages/hu-board/src/server.js`).
- Generates an auth token on first run if none exists.
- Writes a PID file the orchestrator's auto-start logic also reads.

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `No free port in range 4000-4009` | All 10 fallback ports busy | `kj board stop` first, or `--port <free>` |
| Stale `hu-board.pid` | Previous crash didn't clean up | `kj board stop` (now triple-fallback: PID → HTTP shutdown → port-occupant lookup) |
| Browser keeps loading on `--bind 0.0.0.0` | Token required for non-loopback peers | Open the printed `?token=<token>` URL once; the cookie is set thereafter |
| Daemon dies on SIGHUP from parent shell | Pre-v2.7.5 detach bug | Update Karajan; then `kj board start` again |

## Example

```bash
# Default: localhost-only, port 4000
kj board start

# Open in default browser (starts daemon if needed)
kj board open

# Status check
kj board status

# Expose on LAN (token enforced)
kj board start --bind 0.0.0.0

# Custom port
kj board start --port 5050

# Stop
kj board stop
```

## Related

- [SKILL.kj-plan.md](SKILL.kj-plan.md) — produces the data the board displays.
- [SKILL.kj-run.md](SKILL.kj-run.md) — auto-starts the board when generating HUs.
