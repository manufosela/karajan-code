# SKILL: kj init

## What it does

One-time bootstrap for a project that wants to use Karajan: writes
`~/.karajan/kj.config.yml` (global config), seeds `<project>/.karajan/`
with role rule templates (coder-rules, review-rules), brings up
SonarQube via Docker (and **auto-generates the analysis token** via
the Sonar REST API), and walks the user through a wizard that covers
**all** the meaningful runtime knobs:

1. **Coder + reviewer agent** (which CLI to use as default).
2. **Per-role provider** (planner / researcher / architect / refactorer
   / tester / security / solomon / impeccable / perf / hu_reviewer):
   for each one, choose to inherit from coder/reviewer, pick a specific
   CLI, or disable the role.
3. **Pipeline toggles**: triage, SonarQube, HU Board.
4. **Methodology** (TDD vs standard).
5. **Pipeline + HU language**.
6. **Git automation**: `auto_commit`, `auto_push`, `auto_pr`, plus
   `branch_prefix` when auto_commit is on.
7. **HU Board security** (only if HU Board is on): bind host
   (loopback default | `0.0.0.0` with auto-generated token enforced
   for non-loopback peers), port.
8. **Sonar token bootstrap** (when interactive + Docker container up):
   logs in with admin/admin, rotates the default password to a fresh
   value persisted at `~/.karajan/sonar.admin-password` (mode 0600),
   generates the `karajan-cli` analysis token via
   `POST /api/user_tokens/generate`, writes it to the config and to
   `~/.karajan/sonar.token` (mode 0600). Falls back to manual flow
   if any step fails.

Idempotent — re-running on an already initialised project asks
"Reconfigure? [y/N]" first.

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
