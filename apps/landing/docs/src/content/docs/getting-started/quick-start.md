---
title: Quick Start
description: Run your first task with Karajan Code.
---

## Your First Run

After [installing](/docs/getting-started/installation/) Karajan Code and running `kj init`, you're ready to go:

```bash
kj run "Implement user authentication with JWT"
```

This runs the full pipeline with defaults: Claude as coder, Codex as reviewer, TDD methodology.

## Common Workflows

### Coder-only mode (skip review)

```bash
kj code "Add input validation to the signup form"
```

### Review-only mode (review current diff)

```bash
kj review "Check the authentication changes"
```

### Generate an implementation plan

```bash
kj plan "Refactor the database layer to use connection pooling"
```

### Full pipeline with all options

```bash
kj run "Fix critical SQL injection in search endpoint" \
  --coder claude \
  --reviewer codex \
  --reviewer-fallback claude \
  --methodology tdd \
  --enable-triage \
  --enable-tester \
  --enable-security \
  --auto-commit \
  --auto-push \
  --max-iterations 5
```

## What Happens During a Run

```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer → tester? → security? → commiter?
```

1. **Triage** (optional) classifies task complexity and activates roles
2. **Coder** writes code and tests following TDD
3. **SonarQube** runs static analysis with quality gates
4. **Reviewer** checks the code with configurable strictness
5. If issues are found, the **coder** gets another attempt
6. Loop until approved or max iterations reached

## Using via MCP (Recommended)

The best way to use Karajan Code is as an MCP server inside your AI agent:

```json
{
  "mcpServers": {
    "karajan-mcp": {
      "command": "karajan-mcp"
    }
  }
}
```

Then from your agent, simply ask it to use the `kj_run` tool. See [MCP Server guide](/docs/guides/mcp-server/) for details.

## Next Steps

- [Pipeline](/docs/guides/pipeline/) — Understand the full pipeline
- [Configuration](/docs/guides/configuration/) — Customize behavior
- [CLI Reference](/docs/reference/cli/) — All commands and flags
