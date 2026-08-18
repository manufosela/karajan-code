---
title: Work with your agent
description: The v4 model — you task the agent, the agent orchestrates, Karajan governs.
---

The chain in v4 is: **you → your agent → kj → git**. You describe outcomes; your agent (any CLI: Claude Code, Codex, Gemini, Cursor) does the work; kj gives it method, memory and a second pair of eyes; git refuses anything unverified.

You almost never type `kj` yourself. Your agent does — the playbook installed by `kj env install` orders it to.

## What the playbook orders

A task is DONE when its done-statement is literally true, the suite is green, and every commit carries a cross-AI verdict. The invariants:

- **RAG before assuming** — `kj rag query` answers questions about the codebase; the index is built on install and refreshes itself on drift.
- **Card first, on YOUR board** — work is tracked before it starts in the board the project declares (`state_backend` in config): kj's HU Board (`kj hu add|move|list` — your agent creates the card before it codes), your Planning Game, or the board you already use — Linear, Trello, Jira, GitHub Issues — worked through your agent's own MCP/tools (`state_backend: external` + `board.name`; kj never mirrors it). `kj env install` verifies the board is reachable — Karajan does not run without one. Architecture decisions live as git-tracked ADRs: `kj adr add|list`.
- **Parallel work in lanes** — more than one task at a time? `kj worktree start <slug>` gives each its own isolated worktree; every review verdict is stamped with the workspace it ran from, so isolation claims are auditable.
- **Tests prove behavior** — failing test first, suite never left red.
- **Cross-AI review before commit** — a *different* AI reviews every diff.
- **Security findings are never overridable.**
- **Branch first** — the base branch only moves via PR.

## The tools your agent reaches for

- **`kj brief <role>`** — the distilled method of a role (triage, planner, researcher, architect, tester, security, audit) as mission + invariants + deliverable. Your agent absorbs these roles; the briefs keep it honest.
- **`kj agent run <agent> "<task>"`** — delegate work to another AI. kj handles the subprocess plumbing; your agent reads the output and decides.
- **`kj solomon --position "<why>"`** — when your agent disagrees with a rejected review, a **third** AI arbitrates (never the brain, never the reviewer). Its ruling is recorded and obeyed — except security findings, which nobody overrides.
- **`kj report-issue`** — your agent hits a kj bug? It diagnoses it and files a **sanitized** issue upstream (no project code, no paths, no personal data), after asking you. The ecosystem repairs itself.

## Why a different AI reviews

Self-review rubber-stamps. In v4 the reviewer is always a different model family than the orchestrator (Claude orchestrates → Codex reviews, and vice versa), and its verdict binds to the sha256 of the exact diff: change one byte and the verdict is void. This is not a convention — the pre-commit gate enforces it. In this repo's own development, the cross reviewer has repeatedly rejected the author's first version with real findings. It works on us; it will work on you.
