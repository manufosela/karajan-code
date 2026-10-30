---
title: Unattended runs
description: Karajan in CI and scripts, without an agent session at the wheel.
---

Up to 4.x, Karajan also had a **headless mode**: `kj run` and `kj autorun` spawned coder, reviewer and judge agents as subprocesses and drove the loop themselves. That pipeline was retired in 5.0 (see [Migrating to 5.0](/docs/v4/migration/)): the work is done by your agent, and Karajan governs it.

What stays for unattended use:

- **`--non-interactive`** (or `KJ_NON_INTERACTIVE=1`): safe gates auto-answer (warn findings continue, the decision goes to stderr); FAIL findings stop with exit code 1 instead of waiting for an answer.
- **The gates in CI**: `kj harden` seeds the workflows that re-check every PR (review verdicts, policy, privacy, PR size), so a tampered local hook does not get a diff through.
- **Parallel work**: one lane per card with `kj worktree start <slug>` and one agent session inside each. `session.worktree_setup` still declares the per-lane environment (ports, DBs, docker project names) so lanes never collide.

## When to choose which

| Situation | Use |
|---|---|
| You are working WITH an agent (Claude Code, Codex, Gemini, OpenCode) | The environment: this is the default |
| Several independent cards at once | One lane per card (`kj worktree start`), one agent session per lane |
| CI with no agent at all | The gates: `kj review --check`, `kj policy check`, `kj privacy scan` |

## The old pipeline

The subprocess pipeline is documented in the **v3 (historical archive)** section of this site. It describes how Karajan worked before 5.0; to keep using it, stay on `karajan-code@4`.
