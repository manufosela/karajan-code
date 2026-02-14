# Karajan Code

Local CLI to orchestrate two coding agents with SonarQube and an automated review loop.

## Quick start

```bash
npm install
npm link
kj init
kj doctor
kj run "Implement authentication flow"
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

## Notes

- Default mode is `standard` (critical/important focus).
- Set `review_mode: paranoid` and `sonarqube.enforcement_profile: paranoid` for strict gate compliance.
- Use env vars for secrets (`KJ_SONAR_TOKEN`, provider keys).

## Use From Other Agents

### Option A: Subprocess (quickest)

Any agent that can run shell commands can invoke `kj` directly:

```bash
kj run "Fix Sonar critical issues in auth module" \
  --coder codex \
  --reviewer claude \
  --reviewer-fallback codex \
  --max-iteration-minutes 5
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
