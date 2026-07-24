---
title: Command reference
description: The v4 surface — one line per command.
---

The commands a v4 setup actually uses. Everything supports `--help`; agent-facing commands offer `--json` (stdout = exactly one JSON object).

## Setup (once per project, run by a human or their agent)

| Command | Does |
|---|---|
| `kj init` | Config + rules + quality tooling. Agent-safe: falls back to defaults without a TTY, `--json` summary. |
| `kj env install` | Writes the method playbook into CLAUDE.md / AGENTS.md / GEMINI.md (`--target`) and builds the RAG index (`--no-rag`). |
| `kj harden` | Git hooks (lint, commit policy, gate runner), configs, CI workflows. Chains your previous global hooks. |
| `kj review --install-gate` | Enables the pre-commit review gate (tracked marker). |

## Daily (run by the agent)

| Command | Does |
|---|---|
| `kj rag query "<q>"` | Semantic search over the project (auto-refreshes on drift). |
| `kj brief <role>` | Mission + invariants + deliverable of a role. No role → list. |
| `kj review --staged` | Sonar pre-gate on the changed files (BLOCKER/CRITICAL reject deterministically), then cross-AI review; verdict bound to the diff's sha256 and stamped with its workspace. Exit 0/1. |
| `kj worktree start\|list\|done <slug>` | Isolated task lanes: worktree + `feat/<slug>` branch + dependency bootstrap; `done` removes a merged lane. |
| `kj review --check` | Is there an approved verdict for the exact staged diff? (What the hook runs.) |
| `kj solomon --position "<why>"` | Third-AI arbitration of a rejected verdict. Exit 0 approve / 1 reject. |
| `kj agent run <agent> "<task>"` | Delegate a task to another AI and print its output. |
| `kj report-issue --title "<t>"` | File a sanitized kj bug upstream. Never publishes without `--publish`. |

## Inspect (human)

| Command | Does |
|---|---|
| `kj check` | Environment health, 13 checks. |
| `kj doctor` | Deeper diagnosis with fixes. |
| `kj report` | Last session's summary, budget, iterations. |
| `kj board` | HU Board dashboard (when `state_backend: hu-board`). |
| `kj gain` | Token savings analytics. |

## Headless

| Command | Does |
|---|---|
| `kj run "<task>"` | The classic subprocess pipeline — see [Headless mode](/docs/v4/headless/). `--non-interactive` (or `KJ_NON_INTERACTIVE=1`) auto-answers safe gates; FAIL findings stop with exit 1. |
| `kj autorun <spec>` | Spec → plan → run every story → outcome report, unattended. |

Everything else (`kj advanced` lists ~30 more) belongs to the headless pipeline and power users — documented in the **V3 historical archive** ([here](/docs/getting-started/introduction/), clearly marked as legacy).
