---
title: MCP Server
description: Using Karajan Code as an MCP server inside your AI agent.
---

:::note
This page is under construction. Full content coming soon.
:::

## Setup

After `npm install -g karajan-code`, the MCP server auto-registers in Claude and Codex configs.

Manual configuration:

```json
{
  "mcpServers": {
    "karajan-mcp": {
      "command": "karajan-mcp"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `kj_init` | Initialize config and SonarQube |
| `kj_doctor` | Check system dependencies |
| `kj_config` | Show configuration |
| `kj_scan` | Run SonarQube scan |
| `kj_run` | Run full pipeline (with real-time progress notifications) |
| `kj_resume` | Resume a paused session |
| `kj_report` | Read session reports (supports `--trace`) |
| `kj_roles` | List roles or show role templates |
| `kj_code` | Run coder-only mode |
| `kj_review` | Run reviewer-only mode |
| `kj_plan` | Generate implementation plan |
