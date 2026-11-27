---
title: The Steward
description: The piece that checks again, from time to time, that the project's guarantees still hold. What it is, why it exists, when it acts, how you use it and what it does not do.
---

## What it is

The Steward is a periodic check of the project's health. `kj steward sweep` goes through a list of invariants, the things that have to stay true for the method to mean anything, and gives each one a verdict. It only reads: it changes nothing in your code.

The invariants it checks today:

| Invariant | The question it answers |
|---|---|
| `main-ci` | Has the base branch's CI been red for too long (3 days by default)? |
| `security-audit` | Was there a security audit recently (14 days by default)? |
| `vulnerable-deps` | Has a vulnerable dependency been waiting too long (critical 7 days, high 30)? |
| `dead-code-trend` | Is unused code growing since the last sweep? |
| `coverage-config` | Is a coverage threshold configured, and does the CI apply it? |
| `phantom-coverage` | Are there tests that add to the count but only exercise code nothing else reaches? |
| `duplicate-members` | Is a member defined twice in one class, so the first one silently stops running? |
| `runner-collects-agent-worktrees` | Does the test runner leave the agents' worktrees out? |
| `embedder-load` | Can the RAG's embedder load? |
| `merged-unverified` | Was something merged without its required checks green? |

Each verdict is one of four: **ok**, **broken**, **unknown** (the check could not answer) or **not-observable** (it cannot be seen from here). A check that fails is unknown, never ok.

## Why it exists

The other pieces check each change at the moment it happens. But a guarantee also expires without anyone touching the code: a dependency becomes vulnerable, main stays red for days, nobody runs the security audit any more. Every change can be correct while the project as a whole decays.

The Steward is the piece that says "trust expires". It checks again, from time to time, what was true once, and says plainly when it no longer is.

## When it acts

- **When you ask:** `kj steward sweep`, from your terminal or from the agent.
- **Every week, if you want it:** with `steward.action: true` in `.karajan/kj.config.yml`, `kj harden` writes a workflow that sweeps on Mondays at 06:17 UTC (and on demand from GitHub) and commits the report.
- **When the agent starts editing:** the Sentinel tells it, once per session, which invariants are broken or unknown in the last report.
- **Before a review or a commit,** only if you chose to block (below).

## How you use it

Run `kj steward sweep`. It writes the report to `.karajan/steward/report.md` (and `report.json`), seals the sweep in the decision log, and turns each broken invariant into a proposed card on the HU Board. The card is updated rather than duplicated, and it is resolved when the invariant is green again. `kj steward sweep` exits with an error only when something is broken.

By default the Steward **informs**. You decide whether it **blocks**, with `method_gates.steward: block` in the project configuration. Then only two invariants block, and only when they are broken: `vulnerable-deps` and `main-ci`. An unknown verdict never blocks. While they are broken, the agent cannot start editing and `kj review` rejects. Having chosen to block, a missing or unreadable report blocks too: the sweep has to run.

There is no exception to get past it. If the work has to go on, you set `method_gates.steward` back to `inform`. That is your decision, not the agent's: the Sentinel does not let the session touch the governance configuration.

## What it does not do

- **It does not fix anything.** It says what is broken and how to renew it (for example "kj audit --security"); someone has to do it.
- **It does not demand a coverage number.** It checks that a threshold exists and that the CI applies it, not which one.
- **It does not block unless you ask it to,** and even then only for the two hard invariants.
- **It does not judge a change.** That is the [cross review](/docs/pieces/cross-review/) and the [quality checks](/docs/pieces/quality/). The Steward looks at the project, not at the diff.
