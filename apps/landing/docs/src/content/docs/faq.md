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

It runs checks grouped by area (system, config, agent CLIs, Sonar, RAG embedder, CI, tokens, MCP servers, ports, Node and more); `kj doctor --verbose` shows each one with its fix.

Each check ends as `OK`, `FIXED`, `WARN`, `FAIL`, `SKIPPED` or `TIMEOUT`, with a suggested fix when it fails.

---

## Installation & Setup

### Agent binary not found

**Symptom:** `kj doctor` reports an agent CLI as missing, or `kj code` / `kj review --staged` fail naming the agent.

**Cause:** The agent CLI isn't installed or isn't in your PATH.

**Fix:**

```bash
# Verify the binary is accessible
which claude    # or codex, gemini, aider

# If not found, install globally
npm install -g @anthropic-ai/claude-code   # Claude
npm install -g @openai/codex               # Codex
kj install-tools                           # installs the agent CLIs kj needs
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

---

## SonarQube Issues

### Container won't start

**Symptom:** SonarQube not reachable at `http://localhost:9000`.

**Fix:**

```bash
# Check if Docker is running
docker ps

# Start the SonarQube container kj manages (karajan-sonarqube)
kj sonar start
kj sonar status

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

**Symptom:** `kj review --staged` keeps stopping at the Sonar pre-gate.

**Fix options:**

```bash
# Skip the Sonar pre-gate for this review
kj review --staged --no-sonar
```

What blocks is `sonarqube.gate_block_on` (by default: new reliability, security or maintainability rating E, new coverage below 80%, new duplicated lines above 5%).

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

### Reviewer rejects code repeatedly

**Symptom:** `kj review --staged` rejects the same change more than once.

**Fix:** have the coder apply the findings (`kj code --card <id> --retry --brief`), or, if your agent disagrees with them, ask a third AI to arbitrate: `kj solomon --position "<why>"` (security findings are never overridable).

### Picking another reviewer

Pick another reviewer for one review with `kj review --staged --reviewer <agent>`, or set `reviewer_options.fallback_reviewer`; a reviewer out of quota is replaced for that review only, never by the host.

---

## MCP Server Issues

### `Transport closed` after updating Karajan Code

**Symptom:** MCP calls fail immediately (even `kj_config` / `kj_doctor`) and your host reports `Transport closed`.

**Cause:** The MCP host is still connected to an older `karajan-mcp` process. After a version change, Karajan exits stale MCP processes so the host can restart with the updated code.

**Fix:**

```bash
# 1) restart your MCP host session (Claude/Codex)

# 2) verify server registration/list
codex mcp list

# 3) smoke check before long runs
# call kj_config, then kj_doctor
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

When an MCP tool fails, the `category` field of its answer tells you what happened, and `suggestion` how to fix it:

| Error Type | Meaning | Fix |
|-----------|---------|-----|
| `sonar_unavailable` | SonarQube not reachable | Start Docker, run `kj_init` |
| `auth_error` | 401 Unauthorized | Regenerate SonarQube token |
| `config_error` | Invalid configuration | Run `kj_doctor` or `kj_init` |
| `agent_missing` | CLI not found | Install the agent, run `kj_doctor` |
| `timeout` | Time limit exceeded | Increase `timeoutMs` or `maxIterationMinutes` |
| `branch_error` | You are on the base branch | Create a feature branch, then retry |
| `agent_stall` | The agent stopped producing output | Retry with a smaller task |
| `bootstrap_error` | Environment prerequisites not met | Run `kj_doctor` and fix what it lists |
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

**Symptom:** `kj review --publish-pr` or `--verify-pr` fails with a `gh` error.

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

---

## TDD Policy Violations

### Source changes without tests

**Symptom:** `kj review --staged` warns (or, with `kj gates set tests-with-code block`, refuses) that the staged diff touches source files without touching a test.

**Fix options:**

1. **Write tests first** (recommended): modify test files before implementation
2. Deletions and comment-only cleanups pass without a test; anything else needs one.

Test file patterns recognized: `/tests/`, `/__tests__/`, `.test.`, `.spec.`

---

## Cost

Karajan runs on your agents' own CLI subscriptions; the HU Board's **Usage** page (`/usage.html`) sums every agent call kj launched, per project and account, with a CSV per project and month. See [Observability](/docs/guides/observability/).

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

**Debug:** kj does not print plugin load errors today; load the file yourself with `node -e 'import("./.karajan/plugins/my-plugin.js").then((m) => console.log(Object.keys(m)))'` to see its exports.

### "No register() export found"

**Symptom:** Warning in logs about missing `register()`.

**Fix:** Your plugin must export a named `register` function:

```javascript
// Correct
export function register(api) { ... }

// Also accepted: a default export with register
export default { register(api) { ... } }

// Wrong — CommonJS
module.exports = { register(api) { ... } }
```

---

## FAQ

### What AI agents does Karajan Code support?

Claude, Codex, Gemini, Aider, OpenCode, Qwen, Copilot, Kimi and agy out of the box (`kj agents` lists them, `kj doctor` shows which are installed). You can mix and match: use one as coder and another as reviewer. You can also create [custom agents via plugins](/docs/guides/plugins/).

### Can I choose which model each role uses?

Yes. The coder's model follows the card's tier (`kj hu add --tier trivial|standard|deep`) unless you fix one (`roles.coder.model` in the config); the reviewer's comes from `roles.reviewer.model` or `kj review --staged --reviewer-model <model>`. `kj agents` shows which provider holds each role.

### Does it cost money?

Karajan Code itself is free and open source (AGPL-3.0). It runs on your existing AI agent CLI subscriptions (Claude Pro, Codex, etc.), with no additional API keys. You pay only your existing plan, regardless of how many tasks you run. The HU Board's Usage page shows every agent call kj launched, with its tokens and the cost its agent reported.

### Do I need Docker?

Only for SonarQube static analysis. Skip it with `--no-sonar` or `sonarqube.enabled: false`.

### Can I use it without SonarQube?

Yes. SonarQube is optional. Disable it globally:

```yaml
sonarqube:
  enabled: false
```

Or for one review: `kj review --staged --no-sonar`

### What happens when the coder and reviewer disagree?

When your agent disagrees with a rejected review, `kj solomon --position "<why>"` asks a third AI to arbitrate; security findings are never overridable.

### Where do I see what kj measured?

```bash
kj report                       # the project blocks: review truth, panel, coder models (and the latest session, if any)
kj report --session-id <id>     # a specific session
```
