# Troubleshooting Guide

Common issues and solutions when using Karajan Code.

## Installation & Setup

### `kj init` fails with "No AI agents detected"

**Cause**: No supported AI CLI is installed on your system.

**Fix**: Install at least one agent:
```bash
npm install -g @anthropic-ai/claude-code   # Claude
npm install -g @openai/codex                # Codex
npm install -g @anthropic-ai/claude-code @openai/codex  # Both (recommended)
```

Then re-run `kj init`.

### `kj doctor` reports agent as MISS

**Cause**: The agent binary is not in your `$PATH`.

**Fix**:
1. Verify the agent is installed: `which claude` or `which codex`
2. If installed via npm, check your global npm bin: `npm bin -g`
3. Ensure that directory is in your `$PATH`
4. For nvm users: the agent must be installed in your active Node version

### Config file not found

**Cause**: `kj init` was not run, or was run in a different directory.

**Fix**:
```bash
kj init                    # Interactive setup
kj init --no-interactive   # Non-interactive with defaults
```

The config is created at `~/.karajan/kj.config.yml` (global) or `.karajan/kj.config.yml` (project-local).

## SonarQube

### SonarQube container won't start

**Cause**: Docker not running, or `vm.max_map_count` too low (Linux).

**Fix**:
```bash
# Start Docker
sudo systemctl start docker

# Fix vm.max_map_count (Linux only, required by Elasticsearch)
sudo sysctl -w vm.max_map_count=262144
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf

# Start SonarQube
kj sonar start
```

### SonarQube token invalid or expired

**Cause**: The token in `kj.config.yml` is wrong or was revoked.

**Fix**:
1. Open http://localhost:9000
2. Log in (default: `admin` / `admin`)
3. Go to **My Account > Security > Generate Token**
4. Name: `karajan-cli`, Type: **Global Analysis Token**
5. Update the token:
   ```yaml
   # In ~/.karajan/kj.config.yml
   sonarqube:
     token: "sqa_your_new_token_here"
   ```
   Or set the environment variable: `export KJ_SONAR_TOKEN="sqa_..."`

### Quality gate fails repeatedly

**Cause**: SonarQube detects blocking issues that the coder cannot resolve.

**Fix**:
- Run `kj sonar open` to view issues in the browser
- Check if the issues are false positives (mark them as such in SonarQube UI)
- Use `--no-sonar` to skip SonarQube analysis temporarily
- Set `sonarqube.enforcement_profile: "lenient"` in config for fewer blocking rules

## Execution

### Coder times out

**Cause**: The task is too large or the AI agent takes too long.

**Fix**:
```bash
# Increase iteration timeout (default: 5 minutes)
kj run --max-iteration-minutes 10

# Or in config:
# session:
#   max_iteration_minutes: 10
```

Also consider breaking the task into smaller subtasks.

### Claude subprocess hangs or produces no output

**Cause**: Claude Code 2.x introduced three changes that break spawning `claude -p` as a subprocess from Node.js:

1. **`CLAUDECODE` env var**: Claude Code sets `CLAUDECODE=1` to block nested sessions. The subprocess sees it and refuses to start.
2. **stdin inheritance**: The child inherits the parent's stdin and blocks waiting for input that never arrives.
3. **stderr output**: Without a TTY, Claude Code writes structured output (`json`/`stream-json`) to stderr, not stdout.

**Fix** (v1.9.6): Karajan handles all three in `src/agents/claude-agent.js`:

```js
function cleanExecaOpts(extra = {}) {
  const { CLAUDECODE, ...env } = process.env;
  return { env, stdin: "ignore", ...extra };
}

function pickOutput(res) {
  return res.stdout || res.stderr || "";
}
```

4. **`--verbose` required with `stream-json`** (v2.1.71+): Claude Code now requires `--verbose` when combining `--print` with `--output-format stream-json`. Without it, the subprocess exits with an error.

**Fix** (v1.13.1): Karajan adds `--verbose` alongside `--output-format stream-json` in both `runTask` and `reviewTask`.

**Verify manually**:
```bash
# Hangs (inherits env + stdin):
claude -p "Reply PONG" --output-format json

# Works (clean env, no stdin, read stderr):
env -u CLAUDECODE claude -p "Reply PONG" --output-format json < /dev/null 2>&1

# For stream-json (requires --verbose since Claude Code v2.1.71):
env -u CLAUDECODE claude -p "Reply PONG" --output-format stream-json --verbose < /dev/null 2>&1
```

> This only affects Claude Code 2.x as a subprocess. Other agents (Codex, Gemini, Aider) are unaffected.

### Coder hangs on interactive CLI wizards

**Cause**: The coder runs as a non-interactive subprocess (`stdin: "ignore"`). Commands that prompt for user input (e.g. `pnpm create astro`, `npm init`, `create-react-app`) hang forever.

**Fix** (v1.10.0): The coder prompt includes constraints telling the agent to use non-interactive flags (`--yes`, `--no-input`, `--template`, `--defaults`), or report that the task cannot be done non-interactively. If the coder still hangs, run the interactive part manually and then use Karajan for the coding work.

### Checkpoint stops the session unexpectedly

**Cause**: The checkpoint fires every 5 minutes and asks the AI agent what to do via `elicitInput`. If the response is null (timeout, error), older versions treated it as "stop".

**Fix** (v1.10.0): Null/empty responses default to "continue 5 more minutes". Only explicit "4" or "stop" stops the session. Adjust the interval in config:

```yaml
session:
  checkpoint_interval_minutes: 10  # default: 5
```

### Session stopped — cannot resume

**Cause**: `kj_resume` only accepted "paused" sessions.

**Fix** (v1.10.0): `kj_resume` now accepts stopped and failed sessions. It re-runs the flow from scratch with the original task and config.

### Reviewer rejects changes repeatedly (session stalled)

**Cause**: The coder and reviewer are in a loop — the coder can't fix what the reviewer flags.

**What happens**: Karajan detects repeated issues via the `RepeatDetector` and escalates to Solomon (conflict resolution AI), which may pause the session and ask for human input.

**Fix**:
- If paused, resume with guidance: `kj resume --session <id> --answer "Focus on the security issue first"`
- Reduce reviewer strictness: use `--mode relaxed` or set `review_mode: relaxed`
- Skip the reviewer temporarily: `--enable-reviewer false`

### Session stuck in "stalled" state

**Cause**: The same issues keep repeating across iterations.

**Fix**:
```bash
# Check session status
kj report --session <session-id>

# Resume with specific guidance
kj resume --session <id> --answer "Skip the linting issues and focus on functionality"
```

### `kj_plan` runs for a long time with little/no visible output

**Cause**: Some agent CLIs stream slowly or emit sparse output for large prompts.

**What happens now**:
- Karajan emits continuous heartbeat/stall telemetry.
- Planner runs are protected by `session.max_agent_silence_minutes` (default: 20), so completely silent executions are terminated instead of hanging indefinitely.
- Planner runs are also capped by `session.max_planner_minutes` (default: 60), so noisy-but-stuck loops (e.g. repeated reconnect logs) are terminated.

**Fix / diagnostics**:
```bash
# Inspect live run log during MCP execution
kj_status

# Increase silence limit if your planner legitimately needs more quiet time
# session:
#   max_agent_silence_minutes: 30

# Increase hard planner runtime cap for very large planning jobs
# session:
#   max_planner_minutes: 90
```

If the failure persists, split the prompt into smaller planning chunks and run `kj_plan` per chunk.

### TDD policy fails repeatedly

**Cause**: The coder is not generating tests alongside source code.

**Fix**:
- The system will auto-pause after `fail_fast_repeats` (default: 2) failures
- Resume with guidance: `kj resume --answer "Create unit tests in tests/ directory using vitest"`
- Or switch methodology: `--methodology standard` (disables TDD enforcement)

## MCP Server

### `Transport closed` after upgrading Karajan Code

**Symptom**: MCP calls fail immediately (including `kj_config`/`kj_plan`) and your host shows `Transport closed`.

**Cause**: Your host still has an old MCP server process from a previous version. After a version bump, Karajan MCP exits stale processes so the host can restart with fresh code.

**Fix**:
1. Restart the MCP host session (Claude/Codex/new terminal session).
2. Verify the server is registered/listed (`codex mcp list` or host equivalent).
3. Run a quick smoke check (`kj_config`, then a short `kj_plan`) before long runs.

### Orphaned node processes after closing Claude Code

**Cause**: MCP server processes not properly cleaned up when the parent session ends.

**Fix** (v1.2.3+): This is handled automatically via `orphan-guard.js`. The MCP server monitors its parent process and exits when it dies.

For older versions, manually clean up:
```bash
# Find orphaned karajan MCP processes
ps aux | grep "karajan-code/src/mcp/server.js" | grep -v grep

# Kill them
kill <pid1> <pid2> ...
```

### MCP server not responding

**Cause**: The server crashed or the stdio pipe is broken.

**Fix**:
1. Check if the process is running: `ps aux | grep karajan-mcp`
2. Restart your MCP host session — MCP servers are spawned per session
3. If this happened after an update, follow the `Transport closed` checklist above
4. Run `kj doctor` to verify the setup is correct

## Monitoring runs in real time

### `kj-tail` — live colorized log viewer

When Karajan runs via MCP, the host (Claude Code, Codex) shows no progress until the tool call completes. To see what Karajan is doing in real time, use `kj-tail` in a separate terminal.

**Compatibility**: Linux, macOS, and WSL. Requires `bash` and `tail -F` (standard on all three).

**Install** (one-time):

```bash
# Copy the script to a directory in your PATH
cp node_modules/karajan-code/bin/kj-tail ~/.local/bin/kj-tail
chmod +x ~/.local/bin/kj-tail

# Ensure ~/.local/bin is in your PATH (add to .bashrc/.zshrc if needed)
export PATH="$HOME/.local/bin:$PATH"
```

**Usage**:

```bash
# From any directory — pass the project path where kj_run is executing
kj-tail ~/my-project

# If you're already in the project directory
kj-tail
```

**What it shows**:

Karajan writes a `run.log` file to `<project>/.kj/run.log` during every `kj_run`, `kj_code`, and `kj_plan` execution. `kj-tail` tails this file with:

- Color coding by stage: coder (green), reviewer (yellow), sonar (blue), solomon (magenta), errors (red), session/iteration (cyan)
- Timestamps stripped for cleaner output
- Redundant `[agent:output]` tag removed (the output itself is shown)

Example output:

```
[kj_run] started — task="TSK-0010: Add CI/CD..."
[session:start] Session started
[iteration:start] [iteration] Iteration 1/5
[coder:start] [coder] Coder (claude) running
[coder] Creating .github/workflows/ci.yml...
[coder:done] [coder] Finished (lines=82, elapsed=45s)
[sonar:start] Scanning project...
[sonar:fail] Quality gate FAILED — 2 issues
[coder:start] [coder] Re-launching to fix issues...
```

## General Tips

- Always run `kj doctor` after installation to verify everything is working
- Use `--dry-run` to preview what Karajan will do without making changes
- Check session logs with `kj report` for detailed execution traces
- Monitor live execution with `kj-tail <project-dir>` in a separate terminal
- Use `--mode paranoid` for critical code and `--mode relaxed` for prototyping
