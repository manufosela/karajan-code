---
title: The pieces of Karajan
description: Each piece of Karajan explained for people. What it is, why it exists, when it acts, how you use it and what it does not do.
---

Karajan is made of a few pieces. Each one answers a single question about the work your agent does. This section explains them one by one, for people: what each piece is, why it exists, when it acts, how you use it and what it does not do.

The technical guides (the [Sentinel guide](/docs/guides/sentinel/), [the gates](/docs/v4/gates/)) list every message and every rule. Read them when a gate stops you. Read this section to understand why the gate is there.

## Who does what

Three actors take part, and each piece belongs to one of them:

| Actor | What it does |
|---|---|
| **Your agent** (Claude Code, Codex, Gemini CLI) | Writes the code and runs the commands. |
| **kj** | Checks the method with deterministic code, in the session and in git. It never asks a model whether the method was followed. |
| **You** | Decide what is the project's: the rules, the seal, the releases, the exceptions. |

## The pieces along one task

A task goes through the same moments every time. This is what acts at each one:

| Moment | Piece | What it checks |
|---|---|---|
| The session is compacted or resumed | [The Sentinel](/docs/pieces/sentinel/) | It gives the agent back the rules it read at the start. |
| Before any work | [The board](/docs/guides/hu-board/) | Work has a card, and the branch names it. |
| Before touching code | [The project RAG](/docs/karagan/) | The agent asked the project's index about that zone, instead of guessing. |
| Every tool call | [The Sentinel](/docs/pieces/sentinel/) | No edits on the base branch or in another lane, no rule broken, nothing written behind its back. |
| Every tool call, after it ran | [The ledger](/docs/pieces/ledger/) | Records what the session did: queries, edited files, merged cards. |
| Before the review | [Quality before the review](/docs/pieces/quality/) | The diff's own tests pass, no test was weakened, Sonar found nothing serious. |
| Before the commit | [The cross review](/docs/pieces/cross-review/) | A different AI approved this exact diff. |
| The commit and the pull request | git hooks and CI | The verdict is there and matches the diff. Without kj the git hooks do not run, the CI does. |
| The end of the turn | [The Sentinel](/docs/pieces/sentinel/) | The agent does not stop with the method red or with its cards half done. |
| Every week, or when you ask | [The Steward](/docs/pieces/steward/) | The project is still healthy: dependencies, main's CI, invariants. |
| What only you can do | [Human acts](/docs/guides/hardening-against-ai/) | The seal, the release approval and the exceptions are typed by a person, never by the agent. |

## The idea behind all of them

An agent forgets. It forgets the rules after a compaction, it forgets that it skipped a test, and it tells you it ran something it did not run. Asking it to remember does not work, because the one remembering is the one who forgot.

So every piece of Karajan replaces a memory with a mechanism: a check that runs by itself, at the right moment, with the same answer every time. Where a rule used to be an opinion ("I think I followed it"), there is a fact ("the file says so, or it does not").
