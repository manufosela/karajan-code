# Karajan Code

Local CLI to orchestrate two coding agents with SonarQube and an automated review loop.

## Quick start

```bash
git clone git@github.com:manufosela/karajan-code.git
cd karajan-code
./scripts/install.sh
# or: npm run setup
```

The installer asks for:
- if previous instances exist, action:
  - `actualizar (editar configuracion de una instancia existente)`
  - `reemplazar (eliminar lo que hay y configurarlo todo de nuevo)`
  - `anadir nueva (crear otra instancia mas de KJ)`
- if an interrupted install is detected:
  - `continuar (retomar e intentar completar desde el estado actual)`
  - `comenzar desde el principio (borrando lo generado para esa instancia)`
- SonarQube host and token bootstrap
- Default coder/reviewer/fallback
- `KJ_HOME` path
- Automatic MCP registration in Claude and Codex config files
- Optional `kj doctor` execution
- Checks selected AI CLIs; if missing, warns with install URLs (does not block install)

After installation:

```bash
source .karajan/karajan.env
kj run "Implement authentication flow" --coder codex --reviewer claude --methodology tdd
```

### Non-interactive setup (CI/automation)

```bash
./scripts/install.sh \
  --non-interactive \
  --link-global false \
  --kj-home /absolute/path/to/.karajan \
  --sonar-host http://localhost:9000 \
  --sonar-token "$KJ_SONAR_TOKEN" \
  --coder codex \
  --reviewer claude \
  --reviewer-fallback codex \
  --setup-mcp-claude true \
  --setup-mcp-codex true \
  --run-doctor true
```

You can also pass the same values via environment variables (see `node scripts/install.js --help`).

### Multi-instance setup (personal/pro)

Full guide (step by step, with ready-to-copy examples):

- `docs/multi-instance.md`
- `docs/install-two-instances.md` (bloques exactos para crear `personal` y `profesional`)

One-command helper script:

```bash
./scripts/setup-multi-instance.sh
```

## Commands

- `kj init`
- `kj run <task>`
- `kj code <task>`
- `kj review <task>`
- `kj scan`
- `kj doctor`
- `kj report [--list]`
- `kj resume <session-id>`
- `kj sonar status|start|stop|logs`

## Agent Defaults

- `CLAUDE.md`: comportamiento por defecto para Claude Code (`PG -> KJ` con `kj_run`).
- `AGENTS.md`: comportamiento por defecto para Codex (`PG -> KJ` con `kj_run`).

## Notes

- Default mode is `standard` (critical/important focus).
- Default development methodology is `TDD` (test-first). `kj` enforces test updates when source files change.
- You can override per run with `--methodology tdd|standard` (for example, `--methodology standard`).
- Set `review_mode: paranoid` and `sonarqube.enforcement_profile: paranoid` for strict gate compliance.
- Optional coverage pre-step is configured in `kj.config.yml` under `sonarqube.coverage`.
- `sonarqube.coverage` supports both modes: run `coverage.command` before scan, or consume an existing `lcov_report_path` without command.
- Sonar project key is isolated per repo by default; override with `sonarqube.project_key` if you need a fixed key.
- Use env vars for secrets (`KJ_SONAR_TOKEN`, provider keys).
- If `--auto-commit/--auto-push/--auto-pr` is enabled, `kj` enforces base branch sync and uses auto-rebase by default.
- Disable automatic rebase only if needed with `--no-auto-rebase`.

## Use From Other Agents

### Option A: Subprocess (quickest)

Any agent that can run shell commands can invoke `kj` directly:

```bash
kj run "Fix Sonar critical issues in auth module" \
  --coder codex \
  --reviewer claude \
  --reviewer-fallback codex \
  --max-iteration-minutes 5 \
  --methodology tdd
```

### Option B: MCP Server (recommended for reusable tools)

Start the MCP server:

```bash
npm run mcp
```

Exposed MCP tools:
- `kj_init`
- `kj_doctor`
- `kj_config`
- `kj_scan`
- `kj_run`
- `kj_resume`
- `kj_report`
- `kj_code`
- `kj_review`
- `kj_plan`

#### Example MCP config (Claude/Codex style)

```json
{
  "mcpServers": {
    "karajan-mcp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/karajan-code/src/mcp/server.js"],
      "cwd": "/ABSOLUTE/PATH/TO/karajan-code"
    }
  }
}
```

If you need runtime state in a project-local directory, set:

```bash
KJ_HOME=/ABSOLUTE/PATH/TO/karajan-code/.karajan
```
