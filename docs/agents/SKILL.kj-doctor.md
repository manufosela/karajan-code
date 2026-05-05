# SKILL: kj doctor

## What it does

Runs a battery of environment checks (Node version, AI CLIs detected,
ports free, SonarQube reachable, RTK installed, MCP servers healthy,
config file shape, secrets/tokens) and **auto-remediates** what it
safely can: starting Docker SonarQube containers, creating missing
`~/.karajan/` directories, installing optional skill catalogs, etc.

Always run before opening a bug.

## Inputs

| Input | Form | Required |
|---|---|---|
| Detect-only mode | `--check-only` | optional |
| Auto-confirm prompts | `--yes` / `-y` | optional |
| JSON output | `--json` | optional |
| Verbose timing/hints | `--verbose` | optional |
| Skip remediation, just exit code | `--check-only` | optional |

## Outputs

- **stdout**: per-check status (`PASS` / `WARN` / `FAIL`), an actionable
  hint per non-PASS, and a final summary line `kj doctor: N pass / M warn / K fail`.
- **stdout (`--json`)**: structured array `{check, status, message, fixed?}`.
- **disk**: writes `~/.karajan/` skeleton if missing; creates Docker
  containers if `kj-sonar` doesn't exist and Docker is running.
- **exit 0**: zero `FAIL` checks (warnings allowed).
- **exit non-zero**: at least one `FAIL` (count is the exit code, capped at 125).

## Constraints

- Read-mostly on the project. Will only modify `~/.karajan/` (skeleton)
  and `~/.docker/` state (start sonar containers).
- Never touches the project's `package.json` or `.git`.
- Skips remediation when `--check-only` is passed.

## Side effects

- May start the Docker `kj-sonar` + `kj-sonar-db` containers (idempotent).
- May `mkdir -p ~/.karajan/{sessions,plans,hu-stories,domains,...}`.
- May fetch the addyosmani skill catalog if missing (cached in `~/.karajan/skills/addyosmani/`).

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `Docker not running` | Need Docker Desktop / daemon up | Start Docker, rerun |
| `claude CLI not found` | Coder agent not installed | `npm i -g @anthropic-ai/claude-code` (or use `--coder codex` etc.) |
| `Port 4000 occupied` | Another HU Board running | `kj board stop` or `--port` override on next run |
| `~/.karajan not writable` | Permission issue | `chown -R $USER ~/.karajan` |

## Example

```bash
# Full check + remediate
kj doctor

# CI-friendly: detect only, JSON, fail on any FAIL
kj doctor --check-only --json

# After a fresh clone
kj doctor -y
```

## Related

- [SKILL.kj-init.md](SKILL.kj-init.md) — initial project bootstrap.
- [SKILL.kj-board.md](SKILL.kj-board.md) — the board the doctor's port check is about.
