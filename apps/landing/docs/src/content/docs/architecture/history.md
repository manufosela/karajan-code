---
title: Architecture History
description: How Karajan Code's architecture has evolved over time.
---

:::note
This page is under construction. Full content coming soon.
:::

## Timeline

This page documents the major architectural decisions and how Karajan Code has evolved from a simple orchestrator to its current multi-agent pipeline.

### Phase 1: Simple Orchestrator
Initial version with basic coder → reviewer loop.

### Phase 2: Quality Gates
Added SonarQube integration and TDD enforcement.

### Phase 3: Multi-Agent Pipeline
Expanded to 11 roles with configurable pipeline stages.

### Phase 4: MCP Server
Added MCP server for integration with AI agents (Claude, Codex).

### Phase 5: Extensibility (v1.3.0)
Plugin system, retry with backoff, session cleanup, and Git automation.

## References

- [jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) — Hexagonal architecture patterns (ports & adapters) that influenced the agent adapter design.
