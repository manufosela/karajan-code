---
title: Introduction
description: What is Karajan Code and why use it.
---

Karajan Code (`kj`) is a **role-based AI orchestrator**. It defines **13 specialized roles** (triage, researcher, architect, planner, coder, reviewer, tester, security...) and assigns each one to an **AI agent** (Claude, Codex, Gemini, Aider, or OpenCode). The roles determine *what* to do; the agents determine *who* does it. You can mix and match freely — use Claude as coder and Codex as reviewer, or any combination — while the pipeline enforces quality gates, estimated cost controls, and deterministic guards between every stage. Since Karajan uses agent CLIs (not direct APIs), it runs on your existing subscriptions at no extra cost.

## The Problem

There are two ways to use AI coding agents today, and both have serious issues:

**Manual usage** — You run an agent, wait for the code, check it yourself, find issues, re-prompt, and repeat. There's no systematic quality enforcement. It's slow and entirely dependent on your own review skills.

**Automated usage (CI/CD, GitHub Actions)** — You wire agents into pipelines that run on every push or issue. This removes the manual bottleneck, but introduces a new problem: **uncontrolled costs**. Without iteration limits, budget caps, or quality gates, a single task can burn through tokens indefinitely. An agent retrying a failing approach, a reviewer and coder stuck in a loop, or a flaky API triggering unlimited retries — all of these translate to real money with no visibility until the bill arrives.

In both cases, there's no standard way to enforce quality, control spending, or know when to stop.

## The Solution

Karajan Code solves both problems by chaining **roles** with **quality gates** and **cost controls**. Each role is a pipeline stage with a clear responsibility, executed by the AI agent you choose:

1. The **coder** role writes code and tests (e.g. Claude)
2. **Deterministic guards** scan the diff for destructive operations, credential leaks, and perf anti-patterns
3. **SonarQube** performs static analysis (optionally complemented by **SonarCloud**)
4. The **reviewer** role checks for issues (e.g. Codex)
5. If problems are found, the **coder** gets another attempt
6. This loop runs until the code is approved or the iteration limit is reached

Every session has built-in guardrails: **max iterations**, **per-iteration timeouts**, **total session timeouts**, and optional **estimated budget caps** (in USD or EUR). Fail-fast detection stops the loop early when the agents are going in circles. You get full estimated cost reports with `kj report --trace`. Note: Karajan runs CLI agents under your existing subscriptions — **it adds no extra cost**. Budget tracking estimates what the session would cost at API rates, useful for comparison and guardrails.

## Key Features

- **Role-based pipeline** with 13 specialized roles — each assignable to any agent
- **5 AI agents supported**: Claude, Codex, Gemini, Aider, OpenCode — mix and match per role
- **Plugin system** — extend with custom agents via `.karajan/plugins/`
- **Deterministic guards** — output guard (destructive ops, credential leaks), perf guard (frontend anti-patterns), intent classifier (pre-triage without LLM)
- **MCP server** with 18 tools — use `kj` from your AI agent
- **TDD enforcement** — test changes required when source files change
- **SonarQube + SonarCloud** — static analysis with quality gates (local Docker + cloud, complementary)
- **Standalone role commands** — `kj discover`, `kj triage`, `kj researcher`, `kj architect` run each role independently
- **Review profiles** — standard, strict, relaxed, paranoid
- **Estimated budget tracking** — per-session token counting with estimated API-equivalent costs (Karajan itself adds no cost — it uses your CLI subscriptions)
- **Git automation** — auto-commit, auto-push, auto-PR after approval
- **Session management** — pause/resume with fail-fast detection
- **Retry with backoff** — automatic recovery from transient API errors
- **Smart model selection** — auto-selects optimal model per role based on triage complexity
- **Rate limit resilience** — detects rate limits, pauses session, auto-fallback to another agent
- **Interactive checkpoints** — pauses every 5 minutes with a progress report instead of killing long tasks
- **Task decomposition** — triage detects when tasks should be split and creates linked subtasks in [Planning Game](https://github.com/manufosela/planning-game-xp)

## Quality & Testing

Karajan Code is tested with **1559+ automated tests** across 128 test files, covering every pipeline role, guard, config option, and MCP tool. The test suite runs in under 14 seconds using Vitest.

Quality is enforced at multiple layers:
- **SonarQube** (local, via Docker) — full static analysis with quality gates, blocking on critical issues
- **SonarCloud** (cloud, no Docker needed) — complementary cloud-based analysis, advisory mode by default
- **Deterministic guards** — regex-based checks for destructive operations, credential leaks, and perf anti-patterns
- **TDD enforcement** — source changes require corresponding test changes

Both SonarQube and SonarCloud can run together in the same pipeline — SonarQube as the primary gate and SonarCloud as an additional lens.

## Best with MCP

Karajan Code is designed to be used as an **MCP server** inside your AI agent (Claude, Codex, etc.). The agent sends tasks to `kj_run`, gets real-time progress notifications, and receives structured results — no copy-pasting needed.

## Next Steps

- [Installation](/docs/getting-started/installation/) — Install Karajan Code
- [Quick Start](/docs/getting-started/quick-start/) — Run your first task
