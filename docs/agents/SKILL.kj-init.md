# SKILL: kj init

## What it does

One-time bootstrap for a project that wants to use Karajan: writes
`~/.karajan/kj.config.yml` (global config), seeds `<project>/.karajan/`
with role rule templates (coder-rules, review-rules), and optionally
brings up SonarQube via Docker. Idempotent — re-running on an already
initialised project leaves existing files alone.

`kj run` invokes this automatically when it detects a fresh project,
so manual `kj init` is mostly for users who want to inspect/edit the
config before the first run.

## Inputs

| Input | Form | Required |
|---|---|---|
| Skip Docker / SonarQube provisioning | `--no-sonar` | optional |
| Auto-confirm prompts | `--yes` / `-y` | optional |
| Force overwrite existing config | `--force` | optional |
| Verbose | `--verbose` | optional |

## Outputs

- **disk**:
  - `~/.karajan/kj.config.yml` — global config (coder/reviewer
    providers, model overrides, pipeline flags).
  - `<project>/.karajan/coder-rules.md` — per-project coder rules.
  - `<project>/.karajan/review-rules.md` — per-project reviewer rules.
  - `<project>/.gitignore` — extended with Karajan local artifacts if
    needed.
- **Docker**: `kj-sonar` + `kj-sonar-db` containers created and
  started (unless `--no-sonar`).
- **exit 0**: bootstrap complete.
- **exit non-zero**: filesystem error or Docker failure.

## Constraints

- The current working directory must be a directory you own (will not
  attempt to chmod / sudo).
- Will not overwrite `kj.config.yml` if it already exists, unless
  `--force` is passed.
- Docker provisioning is best-effort: if Docker is missing the
  command logs a warning and continues without SonarQube.

## Side effects

- Writes `~/.karajan/` and `<project>/.karajan/` directory trees.
- Starts up to 2 Docker containers (`kj-sonar`, `kj-sonar-db`).
- Adds entries to project `.gitignore`.

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `kj.config.yml already exists` | Re-running on configured project | Use `--force` to overwrite or edit by hand |
| `Docker daemon not running` | Docker Desktop down | Start Docker, rerun (or `--no-sonar`) |
| `EACCES ~/.karajan` | Permission issue | `chown -R $USER ~/.karajan` |

## Example

```bash
# First time setup in a fresh project
kj init -y

# Already configured, just (re-)provision SonarQube
kj init --force --yes

# CI / minimal env without Docker
kj init --no-sonar -y
```

## Related

- [SKILL.kj-doctor.md](SKILL.kj-doctor.md) — verify the bootstrap actually worked.
- [SKILL.kj-run.md](SKILL.kj-run.md) — what you do next.
