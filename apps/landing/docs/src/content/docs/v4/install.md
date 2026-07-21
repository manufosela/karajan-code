---
title: Install
description: Set up the Karajan Environment in a project in under five minutes.
---

Karajan v4 attaches to the AI agent you already work with (Claude Code, Codex, Gemini CLI, Cursor). You install it once per machine, activate it once per project, and from then on your agent follows the method and git enforces it.

## 1. Install kj

```bash
npm install -g karajan-code
```

Or the standalone binary (no Node needed): `curl -fsSL https://karajancode.com/install.sh | sh`.
**Note:** the standalone binary covers the full CLI but not the optional MCP server (native module limitation). If you need MCP, use the npm install.

Requires Node ≥ 22.12 (npm install) and git. At least one AI agent CLI on the PATH; two enables cross-AI review; three enables arbitration.

## 2. Activate the environment in your project

```bash
kj init                    # config, rules, quality tooling (wizard; agent-safe without a TTY)
kj env install             # writes the method into CLAUDE.md, AGENTS.md and GEMINI.md + builds the RAG index
kj harden                  # git hooks: lint, commit policy, the review gate runner
kj review --install-gate   # opt-in: commits now REQUIRE a cross-AI verdict
```

Commit the generated contract files (`.karajan/review-gate`, `.karajan/hooks/`, the agent rule files) — everyone who clones the repo inherits the environment. Each clone runs `git config core.hooksPath .karajan/hooks` once.

## 3. Hand it to your agent

That's the whole setup. From here you talk to your agent, not to kj. A first prompt that works:

```
This project runs under the Karajan Environment. Read the "Karajan method (v4)"
block in this project's rules file and follow it for everything we do:
RAG before assuming, tests first, cross-AI review before every commit.
```

Your agent will discover the rest (`kj brief`, `kj solomon`, `kj report-issue`) from the playbook itself.

## Uninstalling / opting out

Every gate is a file you can see: remove `.karajan/review-gate` to disable the review gate, unset `core.hooksPath` to disable the hooks, delete the managed block in the rule files to remove the method. Nothing is hidden.
