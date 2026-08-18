---
title: Headless mode
description: The classic subprocess pipeline — for unattended runs, under the same gates.
---

Before v4, Karajan WAS the orchestrator: `kj run` spawned coder, reviewer, tester, security and judge agents as subprocesses and drove the loop itself. That pipeline did not go away — it became the **headless mode**, for the cases where no host agent is at the wheel:

- **Unattended delivery** — `kj autorun <spec>` chains spec → plan → user stories → run to completion, with an arbiter resolving conflicts.
- **Parallel lanes** — `kj run --parallel <n>` executes a plan's stories concurrently in per-story git worktrees. Each lane receives `KJ_LANE_SLOT` and `KJ_PORT_OFFSET`, and `session.worktree_setup` declares the per-lane environment (ports, DBs, docker project names) so lanes never collide.
- **Unattended runs** — `--non-interactive` (or `KJ_NON_INTERACTIVE=1`) auto-answers safe gates (warn findings continue, decision on stderr); FAIL findings stop the run with exit code 1 instead of blocking on a board modal.
- **CI / scripted runs** — anywhere without an interactive agent session.

## Same gates, same verdicts

Headless runs are governed by the same contract as your agent: when the repo has the review gate, the pipeline records its internal reviewer's approval as a verdict for the exact staged diff before committing. One gate, two ways of working — you can mix them freely in the same repo.

## When to choose which

| Situation | Use |
|---|---|
| You are working WITH an agent (Claude Code, Codex, Gemini, Cursor) | The environment — this is the v4 default |
| Batch of independent stories overnight | `kj autorun` / `kj run --parallel` |
| No agent CLI available (pure CI) | `kj run` |

## Full pipeline documentation

The subprocess pipeline (24 roles, triage policies, Solomon escalation, budget ceilings, HU Board integration, SonarQube stages) is documented in depth in the **v3 (legacy)** section of this site. "Legacy" means the docs describe the pre-v4 framing — the code is current and maintained; only the center of gravity moved to the environment.
