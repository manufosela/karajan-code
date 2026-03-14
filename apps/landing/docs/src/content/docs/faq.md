---
title: Troubleshooting & FAQ
description: Common problems, solutions, and frequently asked questions about Karajan Code.
---

## Diagnostics

### Running `kj doctor`

The built-in diagnostic command checks your entire setup:

```bash
kj doctor
```

It performs **8 health checks**:

| Check | What it verifies |
|-------|-----------------|
| Config file | `~/.karajan/kj.config.yml` or `.karajan/kj.config.yml` exists |
| Git repository | You're inside a git repo |
| Docker | `docker --version` responds |
| SonarQube | `http://localhost:9000` is reachable and healthy |
| Agent CLIs | Each agent binary (claude, codex, gemini, aider) responds to `--version` |
| Core binaries | node, npm, git are installed |
| Serena MCP | Optional — checks `serena --version` when enabled |
| Rule files | `.md` files exist in `.karajan/` directories |

Each check shows `OK` or `MISS` with a suggested fix.

---

## Installation & Setup

### Agent binary not found

**Symptom:** `kj doctor` shows `MISS` for an agent, or `kj run` fails with "agent not found".

**Cause:** The agent CLI isn't installed or isn't in your PATH.

**Fix:**

```bash
# Verify the binary is accessible
which claude    # or codex, gemini, aider

# If not found, install globally
npm install -g @anthropic-ai/claude-code   # Claude
npm install -g @openai/codex               # Codex
npm install -g @anthropic-ai/claude-code   # Check agent docs for exact package
```

Karajan searches these directories for binaries:
- System PATH (`which`)
- `/opt/node/bin`, `~/.npm-global/bin`, `/usr/local/bin`, `~/.local/bin`
- NVM directories: `~/.nvm/versions/node/*/bin`

### Config file not found

**Symptom:** `kj doctor` reports missing config.

**Fix:**

```bash
kj init
```

This creates `~/.karajan/kj.config.yml` with sensible defaults. For project-specific config, create `.karajan/kj.config.yml` in your project root.

### Invalid configuration values

**Symptom:** Error about invalid `review_mode` or `methodology`.

**Fix:** Ensure valid values:

```yaml
# review_mode must be one of:
mode: standard   # paranoid | strict | standard | relaxed | custom

# methodology must be one of:
development:
  methodology: tdd   # tdd | standard
```

---

## SonarQube Issues

### Container won't start

**Symptom:** SonarQube not reachable at `http://localhost:9000`.

**Fix:**

```bash
# Check if Docker is running
docker ps

# Start SonarQube
docker start sonarqube-db sonarqube

# If containers don't exist, create them
docker compose -f ~/sonarqube/docker-compose.yml up -d

# Wait ~30 seconds for SonarQube to initialize
```

**Linux-specific:** If SonarQube crashes immediately, increase the virtual memory limit:

```bash
sudo sysctl -w vm.max_map_count=262144
# Make permanent:
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
```

### Authentication failed (401)

**Symptom:** `SonarQube authentication failed` during scan.

**Fix:**

1. Open `http://localhost:9000` → My Account → Security
2. Generate a new token (type: **Global Analysis Token**)
3. Update your config:

```yaml
sonarqube:
  token: "squ_your_new_token_here"
```

Or set via environment variable: `export KJ_SONAR_TOKEN=squ_...`

### Quality gate fails repeatedly

**Symptom:** Pipeline blocks on SonarQube quality gate even for minor issues.

**Fix options:**

```bash
# Skip SonarQube for this run
kj run "My task" --no-sonar

# Or use lenient enforcement in config
```

```yaml
sonarqube:
  enforcement_profile: lenient   # Instead of default "strict"
```

Default quality gate blocks on: reliability rating E, security rating E, maintainability rating E, coverage below 80%, duplicated lines above 5%.

### Scan timeout

**Symptom:** SonarQube scan exceeds time limit.

**Fix:** Increase the scanner timeout (default: 15 minutes):

```yaml
sonarqube:
  timeouts:
    scanner_ms: 1800000   # 30 minutes
```

---

## Agent Issues

### Agent times out during execution

**Symptom:** Agent doesn't complete within the iteration time limit.

**Fix:** Increase the per-iteration timeout (default: 15 minutes):

```bash
kj run "Complex task" --max-iteration-minutes 30
```

Or in config:

```yaml
session:
  max_iteration_minutes: 30
```

### Reviewer rejects code repeatedly

**Symptom:** The coder/reviewer loop runs multiple iterations without approval.

**Cause:** The reviewer finds the same issues each iteration (repeat detection triggers after 2 consecutive identical issue sets).

**Fix options:**

1. **Reduce max iterations** to fail fast:
   ```bash
   kj run "Task" --max-iterations 3
   ```

2. **Use relaxed review mode** for less critical code:
   ```bash
   kj run "Task" --mode relaxed
   ```

3. **Resume with guidance** if session pauses:
   ```bash
   kj resume --session <id> --answer "Focus on the security issue, ignore style suggestions"
   ```

### Reviewer output parsing fails

**Symptom:** `Reviewer output must be a JSON object` or `missing boolean field: approved`.

**Cause:** The reviewer agent returned malformed JSON instead of the expected review format.

**Fix:** This is usually a transient issue. The pipeline retries automatically. If it persists:
- Try a different reviewer: `--reviewer claude` instead of `--reviewer codex`
- Use the reviewer fallback config:

```yaml
reviewer: codex
reviewer_fallback: claude
```

---

## MCP Server Issues

### `Transport closed` after updating Karajan Code

**Symptom:** MCP calls fail immediately (even `kj_config` / `kj_plan`) and your host reports `Transport closed`.

**Cause:** The MCP host is still connected to an older `karajan-mcp` process. After a version change, Karajan exits stale MCP processes so the host can restart with the updated code.

**Fix:**

```bash
# 1) restart your MCP host session (Claude/Codex)

# 2) verify server registration/list
codex mcp list

# 3) smoke check before long runs
# call kj_config, then a short kj_plan
```

### MCP server not responding

**Symptom:** Claude Code or Codex can't connect to `karajan-mcp`.

**Fix:**

```bash
# Check if the process is running
ps aux | grep karajan-mcp

# Restart your AI agent (it spawns a new MCP session)
# Or verify installation
karajan-mcp --help
```

### Orphaned Node processes

**Symptom:** Multiple `karajan-mcp` processes accumulate.

**Fix:** Since v1.2.3, Karajan includes an orphan guard that automatically exits when the parent process dies. For older versions:

```bash
# Find and kill orphaned processes
ps aux | grep "karajan-code/src/mcp/server.js"
kill <pid>
```

### MCP error codes

When `kj_run` or other MCP tools return errors, the `errorType` field tells you what happened:

| Error Type | Meaning | Fix |
|-----------|---------|-----|
| `sonar_unavailable` | SonarQube not reachable | Start Docker, run `kj_init` |
| `auth_error` | 401 Unauthorized | Regenerate SonarQube token |
| `config_error` | Invalid configuration | Run `kj_doctor` or `kj_init` |
| `agent_missing` | CLI not found | Install the agent, run `kj_doctor` |
| `timeout` | Time limit exceeded | Increase `timeoutMs` or `maxIterationMinutes` |
| `rate_limit` | Agent hit usage cap | Wait for token window reset, then `kj resume` |
| `git_error` | Not in a git repo | Run `git init` or navigate to project root |

---

## Git Issues

### "Not a git repository"

**Symptom:** Karajan refuses to run.

**Fix:** Karajan requires a git repo. Initialize one or navigate to your project root:

```bash
git init
# or
cd /path/to/your/project
```

### PR creation fails

**Symptom:** `gh pr create` fails during auto-commit.

**Fix:** Ensure the GitHub CLI is installed and authenticated:

```bash
# Install
brew install gh          # macOS
sudo apt install gh      # Debian/Ubuntu

# Authenticate
gh auth login

# Verify
gh repo view
```

### Base branch diverged during run

**Symptom:** Warning about base branch being behind remote.

**Fix:**

```bash
# Manual rebase
git rebase origin/main

# Or use auto-rebase
kj run "Task" --auto-rebase
```

---

## TDD Policy Violations

### Source changes without tests

**Symptom:** `source_changes_without_tests` — the TDD policy detected source file changes without corresponding test changes.

**Fix options:**

1. **Write tests first** (recommended): modify test files before implementation
2. **Disable TDD for this run:**
   ```bash
   kj run "Quick fix" --methodology standard
   ```
3. **Disable in config:**
   ```yaml
   development:
     methodology: standard
     require_test_changes: false
   ```

Test file patterns recognized: `/tests/`, `/__tests__/`, `.test.`, `.spec.`

---

## Budget & Cost Control

### How does budget tracking work?

**Important:** Karajan's cost tracking is **estimated, not actual billing**. Since Karajan runs CLI agents (Claude Code, Codex CLI, etc.) that use your existing subscriptions, the reported costs are an approximation of what you *would spend* if using the APIs directly. They are calculated from token counts (input/output) multiplied by published model pricing rates.

This is useful for:
- Comparing relative cost between different agent/model combinations
- Understanding which pipeline stages consume the most tokens
- Setting guardrails to prevent runaway sessions

View a breakdown with:

```bash
kj report --trace
```

### What's the advantage of using CLI agents vs APIs?

A key benefit of Karajan's CLI-based approach is **predictable cost**. Your AI agents run under your existing subscription plans (Claude Pro, Codex, etc.), so you never pay more than your plan rate regardless of how many tasks you run.

If a CLI agent reaches its usage window limit (e.g., Claude's token cap), the agent process stops — Karajan automatically detects the rate-limit message from the agent's output and pauses the session instead of marking it as failed. You can resume once the token window resets:

```bash
kj resume --session <session-id>
```

Karajan recognizes rate-limit patterns from all supported agents (Claude, Codex, Gemini, Aider), including HTTP 429 errors and provider-specific usage cap messages.

You can also configure an **auto-fallback agent** so the pipeline continues uninterrupted:

```yaml
coder_options:
  fallback_coder: codex   # Switch to Codex if Claude hits its limit
```

Or per-run: `kj run "Task" --coder-fallback codex`

When the primary agent hits a rate limit and a fallback is configured, Karajan automatically switches to the fallback agent for that iteration. If all agents are rate-limited, the session pauses.

### How do I set a budget limit?

Budget limits act as guardrails on estimated costs:

```yaml
budget:
  max_budget_usd: 50
  warn_threshold_pct: 80   # Warns at 80% spent
```

Or per-run:

```bash
kj run "Task" --max-budget-usd 10
```

When the estimated budget reaches 100%, the session ends with reason `budget_exceeded`.

### How do I see costs in EUR?

```yaml
budget:
  currency: eur
  exchange_rate_eur: 0.92
```

Or: `kj report --currency eur`

---

## Plugin Issues

### Plugin not loading

**Symptom:** Custom plugin agent not available.

**Fix:** Check these requirements:

1. File is in the correct directory:
   - Project: `<project>/.karajan/plugins/*.js`
   - Global: `~/.karajan/plugins/*.js`

2. File exports a `register` function:
   ```javascript
   export function register(api) {
     api.registerAgent("my-agent", MyAgentClass, { bin: "my-cli" });
     return { name: "my-plugin" };
   }
   ```

3. File is a valid ES module (uses `import`/`export`, not `require`/`module.exports`)

**Debug:** Enable debug logging to see plugin load details: `--log-level debug`

### "No register() export found"

**Symptom:** Warning in logs about missing `register()`.

**Fix:** Your plugin must export a named `register` function:

```javascript
// Correct
export function register(api) { ... }

// Wrong — default export
export default { register(api) { ... } }

// Wrong — CommonJS
module.exports = { register(api) { ... } }
```

---

## FAQ

### What AI agents does Karajan Code support?

Claude, Codex, Gemini, Aider, and OpenCode out of the box. You can mix and match — use one as coder and another as reviewer. You can also create [custom agents via plugins](/docs/guides/plugins/).

### Can I choose which model each role uses?

Yes. Karajan supports **per-role model selection** at three levels:

**CLI flags** (per-run):
```bash
kj run "Task" --coder-model claude/opus --reviewer-model codex/o4-mini
```

**Config file** (persistent):
```yaml
roles:
  coder:
    provider: claude
    model: claude/sonnet
  reviewer:
    provider: codex
    model: codex/o3
  planner:
    provider: gemini
    model: gemini/pro
```

**Smart model selection** (automatic): When `--smart-models` is enabled (default), triage classifies task complexity and auto-selects the optimal model per role — lightweight models (haiku, flash, o4-mini) for trivial tasks, powerful models (opus, o3, pro) for complex ones. Explicit `--*-model` flags always override smart selection.

Use `kj agents` to see the current model assignment for each role.

### Does it cost money?

Karajan Code itself is free and open source (AGPL-3.0). It runs on your existing AI agent CLI subscriptions (Claude Pro, Codex, etc.) — no additional API keys needed. You pay only your existing plan, regardless of how many tasks you run. Use `kj report --trace` to see estimated per-run cost breakdowns.

### Do I need Docker?

Only for SonarQube static analysis. Skip it with `--no-sonar` or `sonarqube.enabled: false`.

### Can I use it without SonarQube?

Yes. SonarQube is optional. Disable it globally:

```yaml
sonarqube:
  enabled: false
```

Or per-run: `kj run "Task" --no-sonar`

### What review modes are available?

| Mode | Description |
|------|-------------|
| `paranoid` | Most strict — all rules active, requires 100% approval |
| `strict` | Very strict — most rules, high standards |
| `standard` | Balanced — pragmatic rules (default) |
| `relaxed` | Lenient — fewer rules, faster approval |
| `custom` | User-defined rules in `.karajan/` |

### Can I resume a paused session?

Yes. When a session pauses (repeat detection, budget warning, human escalation):

```bash
kj resume --session <session-id> --answer "Your guidance here"
```

### What happens when the coder and reviewer disagree?

After repeated identical rejections (default: 2 iterations), Karajan can:
1. **Solomon escalation** — an AI arbitrator mediates (if `pipeline.solomon.enabled: true`)
2. **Human escalation** — pauses the session for your input
3. **Max iterations reached** — stops and reports the conflict

### How does retry logic work?

Karajan automatically retries on transient errors: connection timeouts, refused connections, HTTP 429/500/502/503/504. It uses exponential backoff (1s → 2s → 4s, max 30s). Configure in:

```yaml
retry:
  max_retries: 3
  backoff_multiplier: 2
  max_backoff_ms: 30000
```

### Where are session logs stored?

Sessions are stored locally. View them with:

```bash
kj report                  # Latest session summary
kj report --trace          # Detailed cost breakdown
kj report --session <id>   # Specific session
```
