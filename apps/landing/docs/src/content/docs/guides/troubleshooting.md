---
title: Troubleshooting
description: Common issues and solutions when running Karajan Code
---

## Claude subprocess hangs or produces no output

**Symptoms:** `kj_run` or `kj_code` with `coder: "claude"` hangs indefinitely, shows `0 lines` in heartbeat, or returns empty output.

**Root cause:** Claude Code 2.x introduced three changes that break spawning `claude -p` as a subprocess from Node.js:

### 1. `CLAUDECODE` nesting guard

Claude Code 2.x sets `CLAUDECODE=1` in its environment to prevent nested sessions. When Karajan's MCP server (which runs inside Claude Code) spawns `claude -p`, the child process sees `CLAUDECODE=1` and refuses to start.

**Fix:** Strip the variable before spawning:

```js
const { CLAUDECODE, ...env } = process.env;
// pass env to execa/spawn options
```

### 2. stdin inheritance blocks the child

When Node.js spawns a child process, it inherits the parent's stdin by default. If the parent (Claude Code / MCP server) is already consuming stdin, the child `claude -p` blocks waiting for input that never arrives.

**Fix:** Detach stdin:

```js
{ stdin: "ignore" }  // in execa/spawn options
```

### 3. Structured output goes to stderr, not stdout

Without a TTY, Claude Code 2.x writes all structured output (`--output-format json` or `stream-json`) to **stderr**. stdout remains empty. If you only read stdout, you get no output.

**Fix:** Read from both and prefer whichever has content:

```js
function pickOutput(result) {
  return result.stdout || result.stderr || "";
}
```

### Complete solution

Karajan implements all three fixes in `src/agents/claude-agent.js`:

```js
function cleanExecaOpts(extra = {}) {
  const { CLAUDECODE, ...env } = process.env;
  return { env, stdin: "ignore", ...extra };
}

function pickOutput(res) {
  return res.stdout || res.stderr || "";
}
```

Every call to `runCommand()` in the Claude agent uses `cleanExecaOpts()`, and every result is read through `pickOutput()`.

### How to verify

```bash
# This will hang (inherits env + stdin):
claude -p "Reply PONG" --output-format json

# This works (clean env, no stdin, read stderr):
env -u CLAUDECODE claude -p "Reply PONG" --output-format json < /dev/null 2>&1
```

:::note
This issue only affects Claude Code 2.x when spawned as a subprocess. Other agents (Codex, Gemini, Aider) are not affected. Fixed in Karajan v1.9.6.
:::

## Checkpoint stops the session unexpectedly

**Symptoms:** `kj_run` stops after a few minutes even though the coder is making progress.

**Root cause:** The interactive checkpoint system fires every 5 minutes (configurable). When running via MCP, it asks the AI agent what to do via `elicitInput`. If the response is null (timeout, error, or the AI didn't understand the question), older versions treated that as "stop".

**Fix (v1.10.0):** Null/empty responses now default to "continue 5 more minutes". Only an explicit "4" or "stop" triggers a session stop.

You can also adjust the checkpoint interval:

```yaml
# kj.config.yml
session:
  checkpoint_interval_minutes: 10  # default: 5
```

## Coder hangs on interactive CLI wizards

**Symptoms:** `kj_run` or `kj_code` hangs when the task requires running an interactive CLI like `pnpm create astro`, `npm init`, or `create-react-app`.

**Root cause:** The coder agent runs as a non-interactive subprocess with `stdin: "ignore"`. Any command that prompts for user input will hang forever.

**Fix (v1.10.0):** The coder prompt now includes subprocess constraints that instruct the agent to:
- Use non-interactive flags: `--yes`, `--no-input`, `--template <name>`, `--defaults`
- Never run commands that wait for user input
- Report clearly if a task cannot be completed non-interactively

If the coder still hangs, consider running the interactive part manually and then using Karajan for the coding work.

## Session stopped — cannot resume

**Symptoms:** `kj_resume` says the session has status "stopped" and won't resume it.

**Fix (v1.10.0):** `kj_resume` now accepts stopped and failed sessions (not just paused). It re-runs the flow from scratch with the original task and config.

## No progress visible during MCP execution

**Symptoms:** You launch `kj_run` via MCP (from Claude Code, Codex, etc.) and the host shows no output for minutes. You don't know if Karajan is running, stuck, or finished.

**Root cause:** MCP tool calls don't stream partial output. The host only shows the final result when the call completes. Long phases (SonarQube scans, coder runs) produce no visible feedback.

**Fix:** Use `kj-tail` in a separate terminal to monitor the live run log.

### Installing kj-tail

**Compatibility**: Linux, macOS, and WSL. Requires `bash` and `tail -F` (standard on all three).

```bash
# Copy from the Karajan package to a directory in your PATH
cp node_modules/karajan-code/bin/kj-tail ~/.local/bin/kj-tail
chmod +x ~/.local/bin/kj-tail

# Ensure ~/.local/bin is in your PATH (add to .bashrc/.zshrc if needed)
export PATH="$HOME/.local/bin:$PATH"
```

### Usage

```bash
# From any directory — pass the project path where kj_run is executing
kj-tail ~/my-project

# If you're already in the project directory
kj-tail
```

`kj-tail` tails `<project>/.kj/run.log` with color coding by stage:

| Color | Stage |
|-------|-------|
| **Green** | Coder |
| **Yellow** | Reviewer |
| **Blue** | SonarQube |
| **Magenta** | Solomon |
| **Red** | Errors / failures |
| **Cyan (bold)** | Session, iteration, kj_run |
| **Gray** | Heartbeats |

It strips timestamps and the redundant `[agent:output]` tag for a clean, readable stream.

:::tip
Open a second terminal and run `kj-tail` whenever you launch `kj_run` via MCP. It's the best way to follow what Karajan is doing in real time.
:::
