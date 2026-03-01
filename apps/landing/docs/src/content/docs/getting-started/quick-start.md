---
title: Quick Start
description: Run your first task with Karajan Code in 5 minutes.
---

import { Steps } from '@astrojs/starlight/components';

This guide assumes you've already [installed Karajan Code](/docs/getting-started/installation/) and run `kj init`.

## Your first run

<Steps>

1. **Navigate to your project**

   ```bash
   cd /path/to/your/project
   ```

2. **Run a task**

   ```bash
   kj run "Add input validation to the signup form"
   ```

   This launches the full pipeline with your configured defaults (e.g., Claude as coder, Codex as reviewer, TDD methodology).

3. **Watch the pipeline**

   You'll see real-time output as each role executes:

   ```
   [coder]    Writing validation logic and tests...
   [sonar]    Quality gate passed — 0 blockers, 0 critical
   [reviewer] APPROVED — no issues found
   ✔ Pipeline completed in 2m 34s (iteration 1/5)
   ```

   If the reviewer finds issues, the coder gets another attempt. The loop continues until approval or the iteration limit is reached.

4. **Check the results**

   ```bash
   git diff                  # See what changed
   kj report                 # View session summary
   kj report --trace         # Detailed cost breakdown per stage
   ```

</Steps>

## Three ways to use `kj`

### 1. Full pipeline (`kj run`)

The standard workflow — coder writes, SonarQube scans, reviewer checks, loop until approved:

```bash
kj run "Fix the login bug that ignores empty passwords"
```

### 2. Coder only (`kj code`)

Skip the review loop. Useful for quick changes you'll review yourself:

```bash
kj code "Add a loading spinner to the dashboard"
```

### 3. Reviewer only (`kj review`)

Review the current diff without writing code. Useful after manual changes:

```bash
kj review "Check my authentication refactor"
```

## Using via MCP (recommended)

The most powerful way to use Karajan Code is as an **MCP server** inside your AI agent. After `npm install -g karajan-code`, the MCP server auto-registers in Claude and Codex.

From your agent, simply ask it to run a task:

> "Use kj_run to fix the SQL injection vulnerability in the search endpoint"

The agent sends the task to `kj_run`, gets real-time progress notifications, and receives structured results — all without leaving the conversation.

Manual MCP configuration (if needed):

```json
{
  "mcpServers": {
    "karajan-mcp": {
      "command": "karajan-mcp"
    }
  }
}
```

See the [MCP Server guide](/docs/guides/mcp-server/) for the full list of 11 available tools.

## Common options

| Flag | What it does |
|------|-------------|
| `--coder claude` | Choose which agent writes code |
| `--reviewer codex` | Choose which agent reviews |
| `--methodology tdd` | Enforce test-driven development |
| `--mode paranoid` | Use the strictest review profile |
| `--enable-triage` | Auto-classify task complexity |
| `--enable-security` | Run OWASP security audit |
| `--auto-commit` | Git commit after approval |
| `--no-sonar` | Skip SonarQube analysis |
| `--max-iterations 3` | Limit coder/reviewer loops |

For the full list, see the [CLI Reference](/docs/reference/cli/).

## What happens during a run

```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer → tester? → security? → commiter?
```

1. **Triage** (optional) classifies task complexity and activates only necessary roles
2. **Coder** writes code and tests following TDD methodology
3. **SonarQube** (optional) runs static analysis with quality gates
4. **Reviewer** checks the code with configurable strictness
5. If issues are found, the **coder** gets another attempt with the reviewer's feedback
6. Loop until approved or the iteration limit is reached

Built-in guardrails prevent runaway costs: max iterations, per-iteration timeouts, total session timeouts, and optional budget caps.

## Next Steps

- [Pipeline](/docs/guides/pipeline/) — Understand each role in detail
- [Configuration](/docs/guides/configuration/) — Customize the pipeline
- [CLI Reference](/docs/reference/cli/) — All commands and flags
- [Examples](/docs/examples/fix-a-bug/) — Real-world workflow examples
