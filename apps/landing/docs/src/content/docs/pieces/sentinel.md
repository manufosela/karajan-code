---
title: The Sentinel
description: The watchman inside your agent's session. What it is, why it exists, when it acts, how you use it and what it does not do.
---

## What it is

The Sentinel is a set of hooks that `kj harden` installs in Claude Code. Claude Code calls them at fixed moments of the session, and each one is a small program that answers yes or no. When the answer is no, the action does not happen, and the agent reads why, with a link to the rule.

The hooks are wired in `.claude/settings.json` and run the guards of your installed kj package (`kj-hook`), not copies in the project, so what runs is always the kj you installed. `kj sentinel verify` checks that the wiring still calls those guards. Older installs kept copies of the scripts in `.karajan/harness/`; `kj harden` retires them. That directory now holds the session state (the [ledger](/docs/pieces/ledger/)) and the log of blocks.

## Why it exists

A rule written in a file is read once. After a compaction the agent has lost it, and in the middle of a long task it skips it without noticing. Telling it again does not help: the one who has to remember is the one who forgot.

The Sentinel does not ask the agent to remember anything. It checks at the moment of the action, before it runs, so there is nothing to undo. Every check is deterministic code: no model decides whether the method was followed.

## When it acts

| Moment | What it does |
|---|---|
| **Before every tool call** | Blocks what breaks the method, before it runs. See the list below. |
| **After every tool call** | Writes what happened in the [ledger](/docs/pieces/ledger/). It never blocks. |
| **When the agent wants to end its turn** | Does not let it stop with the method red, or with its cards waiting and no stated reason. |
| **After a compaction or a resume** | Gives the agent back the rules it read at the start, short, with the state of the session. |

### Before every tool call

These are the main things it stops. The [Sentinel guide](/docs/guides/sentinel/) has every message:

- Editing on the base branch (`main`), or in another session's lane.
- Starting work with no card, or on a branch that names no card.
- Editing source code the project RAG was not asked about.
- Writing repository files from Bash, where no check can see what is written.
- Committing without an approved review verdict for that exact diff, or staging with `git add -A`.
- Discarding changes the session did not make (they may be your uncommitted work).
- Touching the supervisor's own files or the governance configuration (policies, gates, rules).
- Publishing AI attribution in a pull request, issue or release.
- Running `git` or `gh` under an account other than the one the clone declared.
- Breaking a rule from your own Markdown files, once you approved it (`kj rules approve`).

### When the agent wants to end its turn

The turn does not end while there are merged cards not moved on the board, source edited on the base branch or on a branch with no card, or source added without touching a single test. Nor while the cards the session took are still waiting and the agent does not say why it stops (`Me paro por <reason>` or `Stopping because <reason>`) with a reason kj can check.

**After 3 blocks in a row it steps aside.** It lets the turn end, writes the event in the session state and tells the agent to review `kj sentinel status` with you. From then on it lets the turn end until the session is green again. The reason: sometimes the agent cannot fix it alone (it needs a decision from you, or kj is wrong), and without that limit it would loop, spending tokens, unable to ask you.

The hold for waiting cards has its own count and steps aside the same way after 3 holds in a row.

Stepping aside only lets the agent stop talking. It lets nothing into the repository: the commit still needs its verdict, and the CI still runs on the pull request.

One block never steps aside: the Sentinel's wiring changed outside `kj harden` (or, in an older install, its scripts). That is not a Sentinel failure, it is tampering.

## How you use it

You do not run it. `kj harden` installs it once and it explains itself every time it acts. Your agent reads the message, does the sanctioned thing instead, and goes on.

- `kj sentinel status`: what the session did and any violation the end of the turn would block on.
- `kj sentinel verify`: whether the hooks still call the guards of your installed kj.

**You can switch it off; the agent cannot.** Start the host with `KJ_SENTINEL_OFF=1` in its environment. The variable is read from the environment the host was started with, so a command the agent runs cannot set it. You may want it when kj itself fails or blocks you by mistake, or when you work on kj. Even then some guards stay on: the supervisor's files, the governance configuration, the phone key, AI attribution, issues for karajan-code and discarding changes the session did not make. The git hooks and the CI do not read the variable.

Inside the session there is no escape (ADR 0015). A decision that belongs to the project has its own channel, and you take it in your terminal: a dated exception with `kj policy grant`, a new rule with `kj rules approve`.

## What it does not do

- **It does not judge the code.** It checks the method (card, branch, review, tests touched). Whether the code is right is the [cross review](/docs/pieces/cross-review/)'s job.
- **It does not run your tests** at the end of the turn, nor read the reviews.
- **It does not work outside Claude Code.** Codex and Gemini CLI get the same rules in `AGENTS.md`, and the git hooks and CI apply to them, but not the Sentinel.
- **It does not protect a repository from someone without kj.** On a teammate's machine without kj nothing stops them locally; on the pull request, the CI does.
- **It does not hang your session over its own bug.** When a check fails while it judges a command that changes something, that command stops and says why. Everything else (the end-of-turn check, the ledger writer) steps aside on its own errors.
