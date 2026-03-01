---
title: Introduction
description: What is Karajan Code and why use it.
---

Karajan Code (`kj`) orchestrates multiple AI coding agents through an automated pipeline: code generation, static analysis, code review, testing, and security audits — all in a single command.

## The Problem

Running an AI coding agent and manually reviewing its output is slow and error-prone. You write a prompt, wait for the code, check it yourself, find issues, re-prompt, and repeat. There's no systematic quality enforcement.

## The Solution

Karajan Code chains agents together with **quality gates**:

1. The **coder** writes code and tests
2. **SonarQube** performs static analysis
3. The **reviewer** checks for issues
4. If problems are found, the **coder** gets another attempt
5. This loop runs until the code is approved or the iteration limit is reached

## Key Features

- **Multi-agent pipeline** with 11 configurable roles
- **4 AI agents supported**: Claude, Codex, Gemini, Aider
- **MCP server** with 11 tools — use `kj` from your AI agent
- **TDD enforcement** — test changes required when source files change
- **SonarQube integration** — static analysis with quality gates
- **Review profiles** — standard, strict, relaxed, paranoid
- **Budget tracking** — per-session token and cost monitoring
- **Git automation** — auto-commit, auto-push, auto-PR after approval
- **Session management** — pause/resume with fail-fast detection
- **Plugin system** — extend with custom agents
- **Retry with backoff** — automatic recovery from transient API errors

## Best with MCP

Karajan Code is designed to be used as an **MCP server** inside your AI agent (Claude, Codex, etc.). The agent sends tasks to `kj_run`, gets real-time progress notifications, and receives structured results — no copy-pasting needed.

## Next Steps

- [Installation](/docs/getting-started/installation/) — Install Karajan Code
- [Quick Start](/docs/getting-started/quick-start/) — Run your first task
