---
title: Introduction
description: What is Karajan Code and why use it.
---

Karajan Code (`kj`) orchestrates multiple AI coding agents through an automated pipeline: code generation, static analysis, code review, testing, and security audits — all in a single command.

## The Problem

There are two ways to use AI coding agents today, and both have serious issues:

**Manual usage** — You run an agent, wait for the code, check it yourself, find issues, re-prompt, and repeat. There's no systematic quality enforcement. It's slow and entirely dependent on your own review skills.

**Automated usage (CI/CD, GitHub Actions)** — You wire agents into pipelines that run on every push or issue. This removes the manual bottleneck, but introduces a new problem: **uncontrolled costs**. Without iteration limits, budget caps, or quality gates, a single task can burn through tokens indefinitely. An agent retrying a failing approach, a reviewer and coder stuck in a loop, or a flaky API triggering unlimited retries — all of these translate to real money with no visibility until the bill arrives.

In both cases, there's no standard way to enforce quality, control spending, or know when to stop.

## The Solution

Karajan Code solves both problems by chaining agents with **quality gates** and **cost controls**:

1. The **coder** writes code and tests
2. **SonarQube** performs static analysis
3. The **reviewer** checks for issues
4. If problems are found, the **coder** gets another attempt
5. This loop runs until the code is approved or the iteration limit is reached

Every session has built-in guardrails: **max iterations**, **per-iteration timeouts**, **total session timeouts**, and optional **budget caps** (in USD or EUR). Fail-fast detection stops the loop early when the agents are going in circles. You get full cost reports with `kj report --trace`.

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
