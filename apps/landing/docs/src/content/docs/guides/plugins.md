---
title: Plugin System
description: Extend Karajan Code with custom agents via plugins.
---

Karajan Code's plugin system lets you register custom AI agents without modifying the core codebase. Create a `.js` file, implement the `BaseAgent` interface, and your agent becomes available across the entire pipeline.

## Plugin discovery

Plugins are auto-discovered from two locations:

1. **Project-level**: `<project>/.karajan/plugins/*.js`
2. **User-level**: `~/.karajan/plugins/*.js` (or `$KJ_HOME/plugins/`)

All `.js` files in these directories are loaded. Project plugins load first, then user plugins. Plugins that fail to load are logged as warnings without breaking the rest.

## Creating a plugin

A plugin is a JavaScript module that exports a `register` function:

```javascript
// ~/.karajan/plugins/my-agent.js

import { BaseAgent } from "karajan-code/src/agents/base-agent.js";
import { runCommand } from "karajan-code/src/utils/process.js";
import { resolveBin } from "karajan-code/src/agents/resolve-bin.js";

class MyAgent extends BaseAgent {
  async runTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const model = this.getRoleModel(task.role || "coder");

    const args = ["generate", "--input", task.prompt];
    if (model) args.push("--model", model);

    const res = await runCommand(resolveBin("my-cli"), args, {
      timeout,
      onOutput: task.onOutput
    });

    return {
      ok: res.exitCode === 0,
      output: res.stdout,
      error: res.stderr,
      exitCode: res.exitCode
    };
  }

  async reviewTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const model = this.getRoleModel(task.role || "reviewer");

    const args = ["review", "--format", "json", "--input", task.prompt];
    if (model) args.push("--model", model);

    const res = await runCommand(resolveBin("my-cli"), args, {
      timeout,
      onOutput: task.onOutput
    });

    return {
      ok: res.exitCode === 0,
      output: res.stdout,
      error: res.stderr,
      exitCode: res.exitCode
    };
  }
}

export function register(api) {
  api.registerAgent("my-agent", MyAgent, {
    bin: "my-cli",
    installUrl: "https://github.com/example/my-cli#install"
  });

  return { name: "my-agent-plugin" };
}
```

## The BaseAgent interface

Every custom agent must extend `BaseAgent` and implement two methods:

### runTask(task)

Called when the agent acts as **coder**, **planner**, **refactorer**, or any code-writing role.

**Input:**
```javascript
{
  prompt: "string",        // Full prompt with instructions
  role: "coder",           // Current role name
  onOutput: function       // Optional: stream output callback
}
```

**Expected return:**
```javascript
{
  ok: true,                // true if agent succeeded
  output: "string",        // Agent's stdout
  error: "string",         // Agent's stderr
  exitCode: 0              // Process exit code
}
```

### reviewTask(task)

Called when the agent acts as **reviewer**. Same input/output format as `runTask`.

### Helper methods

`BaseAgent` provides these helpers:

- `this.getRoleModel(role)` — Returns the configured model for the given role (from `config.roles[role].model`)
- `this.isAutoApproveEnabled(role)` — Whether auto-approve is enabled
- `this.config` — Full Karajan configuration
- `this.logger` — Logger instance
- `this.name` — Agent name

## The register API

The `api` object passed to your `register` function provides:

### api.registerAgent(name, AgentClass, metadata)

Register a custom agent in the global registry.

**Parameters:**
- `name` (string) — Unique agent identifier used in config and CLI
- `AgentClass` (class) — Class extending `BaseAgent`
- `metadata` (object) — Agent metadata:
  - `bin` (string) — CLI binary name (used for availability checking)
  - `installUrl` (string) — Installation URL (shown when agent is missing)

**Return value:**

Your `register` function should return an object with at least `name`:

```javascript
return { name: "my-plugin", version: "1.0.0" };
```

## Using your plugin

Once the plugin is in place, use the agent name in config or CLI:

**Config:**
```yaml
coder: my-agent
reviewer: my-agent

roles:
  coder:
    model: my-agent/fast-model
  reviewer:
    model: my-agent/smart-model
```

**CLI:**
```bash
kj run "Add authentication" --coder my-agent --reviewer my-agent
```

**MCP:**
```json
{
  "tool": "kj_run",
  "params": {
    "task": "Add authentication",
    "coder": "my-agent",
    "reviewer": "my-agent"
  }
}
```

## Minimal plugin example

The simplest possible plugin:

```javascript
// ~/.karajan/plugins/echo-agent.js

import { BaseAgent } from "karajan-code/src/agents/base-agent.js";

class EchoAgent extends BaseAgent {
  async runTask(task) {
    return { ok: true, output: `Echo: ${task.prompt}`, error: "", exitCode: 0 };
  }

  async reviewTask(task) {
    const review = JSON.stringify({
      approved: true,
      blocking_issues: [],
      suggestions: [],
      confidence: 1.0
    });
    return { ok: true, output: review, error: "", exitCode: 0 };
  }
}

export function register(api) {
  api.registerAgent("echo", EchoAgent, { bin: null });
  return { name: "echo-plugin" };
}
```

## Error handling

Plugins should handle errors gracefully:

```javascript
async runTask(task) {
  try {
    const res = await runCommand(resolveBin("my-cli"), args, { timeout });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  } catch (err) {
    this.logger.error(`Agent error: ${err.message}`);
    return { ok: false, output: "", error: err.message, exitCode: 1 };
  }
}
```

If a plugin fails to load (syntax error, missing dependency), Karajan logs a warning and continues. Other plugins and built-in agents are not affected.

## Built-in agents for reference

The built-in agents follow the same pattern as plugins:

- `src/agents/claude-agent.js` — Anthropic Claude
- `src/agents/codex-agent.js` — OpenAI Codex
- `src/agents/gemini-agent.js` — Google Gemini
- `src/agents/aider-agent.js` — Aider
- `src/agents/opencode-agent.js` — OpenCode CLI wrapper

Study these files for real-world examples of `runTask` and `reviewTask` implementations.
