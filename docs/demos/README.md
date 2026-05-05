# Karajan Code — Demo recordings

Scripts for recording reproducible asciinema demos of Karajan Code,
plus the published `.cast` files when available.

## Why scripts and not pre-recorded `.cast` only?

Karajan changes weekly. A `.cast` recorded against v2.7.x lies
about features added in v2.9 and v2.10. The scripts here are the
**source of truth** — re-record per release with the same script
and the demo stays fresh.

## Available scripts

| Script | Length | Purpose | Requires |
|---|---|---|---|
| [happy-path.txt](happy-path.txt) | ~3 min | Zero-config: \"Build a REST API for a todo list\" → working code + tests | A coder agent CLI logged in (claude / codex / gemini) |
| [agent-readiness.txt](agent-readiness.txt) | ~1 min | `kj audit --agent-readiness` against this repo → 100/100 | None — pure static analysis |
| [audit-with-llm.txt](audit-with-llm.txt) | ~2 min | `kj audit` two-phase against a sample repo: deterministic findings → LLM analysis | A coder agent CLI logged in |

## How to record

```bash
# Install asciinema once
brew install asciinema     # macOS
sudo apt install asciinema # Debian / Ubuntu

# Pick a clean terminal (Terminal.app on macOS, GNOME Terminal on Linux).
# Width 100 cols, height 30 rows is the sweet spot for readability +
# embed size on the landing page.

# Start recording
asciinema rec docs/demos/agent-readiness.cast \\
  --title \"Karajan Code — agent-readiness audit\" \\
  --idle-time-limit 2

# Type the commands from the .txt file at human pace.
# Hit Ctrl+D or `exit` to stop.
```

## How to publish (optional)

```bash
# Account-less local share
asciinema upload docs/demos/agent-readiness.cast
# → returns a URL like https://asciinema.org/a/XXXXX

# Or self-host: copy the .cast to the landing repo's static dir and
# embed via the asciinema-player web component.
```

## How to embed on the landing

```html
<!-- Drop into karajan-landing/docs/src/components/Demo.astro -->
<asciinema-player
  src=\"/demos/agent-readiness.cast\"
  cols=\"100\"
  rows=\"30\"
  idle-time-limit=\"2\"
  poster=\"npt:0:5\"
  preload
></asciinema-player>
```

(`asciinema-player` ships as an npm package: `asciinema-player`. Add
its CSS + JS once in the landing's base template.)

## Pre-recording checklist

- [ ] Repo is on a tagged release (no `dev` markers in stdout).
- [ ] `kj doctor` passes — nothing red.
- [ ] No notification overlays / Slack / mail running in the visible window.
- [ ] Shell prompt is short (`PS1='$ '`) so output isn't squashed.
- [ ] Coder agent CLI is logged in (script will fail at the `kj run` step otherwise).
- [ ] `~/.karajan/sessions/` is empty (`kj clean -y --retention 0` if not).
- [ ] Git status is clean (the demo will write commits — start from a fresh branch).

## Re-record cadence

- Re-record on every **minor** version bump (v2.10 → v2.11 etc.) — feature surface changed.
- Re-record on **patch** bumps only if the visible CLI output changed.
- Each recording is one commit: `docs(demos): re-record agent-readiness.cast against vX.Y.Z`.
