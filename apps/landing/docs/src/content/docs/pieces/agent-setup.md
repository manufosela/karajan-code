---
title: What kj installs in your agent
description: The rules, the skill, the hooks and the RAG kj gives your agent. What they are, why they exist, when they act, how you use them and what they do not do.
---

## What it is

Your agent (Claude Code, Codex, Gemini CLI) is not part of kj, but kj gives it what it needs to follow the method:

| What | Where | For which agent |
|---|---|---|
| **The rules of the method** | A block kj manages inside `AGENTS.md` | All of them read it. kj no longer writes `CLAUDE.md` or `GEMINI.md`. |
| **The working-with-karajan skill** | `.claude/skills/working-with-karajan/SKILL.md` | Claude Code. How to go on when a gate stops it. |
| **The Sentinel's hooks** | `.claude/settings.local.json`, personal and out of git | Claude Code. See [the Sentinel](/docs/pieces/sentinel/). |
| **The project RAG as a tool** | Your personal Claude Code configuration | Claude Code. See [the RAG](/docs/pieces/rag/). |
| **Skills on demand** | `kj skills search`, `kj skills install` | Searches the skills catalog and installs them in the project. |

## Why it exists

An agent starts every session knowing nothing about your project's method. If it has to learn it from you each time, it learns it differently each time. kj writes the method where the agent looks for it, and puts the checks where the agent cannot skip them.

The rules and the skill tell the agent what to do. The hooks and the gates check that it did it. Both are needed: rules alone are forgotten, checks alone feel arbitrary.

## When it acts

- `kj env install` sets up the environment: the rules in `AGENTS.md`, the RAG server, the enforcement (`kj harden`: git hooks, the review gate, the Sentinel) and the RAG index if there is none.
- `kj harden` installs the skill and the Sentinel's hooks, and keeps them up to date when kj changes. If someone edits the hooks by hand, the Sentinel notices and blocks until `kj harden` restores them.
- From then on, the agent reads `AGENTS.md` at the start of each session, and the Sentinel gives the rules back after a compaction.

## How you use it

Run `kj env install` once in the project. With `--no-enforce` it leaves out the gates, with `--no-rag` the index. When kj announces a new version, the agent tells you what it brings; updating is your choice.

The block kj manages in `AGENTS.md` is kj's: edit outside it, and kj keeps your part. A copy of the skill without kj's mark is yours too, and kj leaves it alone.

## What it does not do

- **It does not install your agent** or log you into it.
- **It does not give Codex or Gemini CLI the Sentinel.** They get the rules in `AGENTS.md`; the git hooks and the CI apply to everyone.
- **It does not wire your agent in the shared configuration.** The hooks and the RAG go in your personal settings, so a teammate who uses Claude Code without kj is not blocked.
