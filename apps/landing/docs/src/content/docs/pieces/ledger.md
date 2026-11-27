---
title: The ledger
description: The session's record of facts that the gates read instead of the agent's word. What it is, why it exists, when it acts, how you use it and what it does not do.
---

## What it is

The ledger is a file on your machine, `.karajan/harness/sentinel-state.json`, where the [Sentinel](/docs/pieces/sentinel/) writes what each session of your agent did. It is written after every tool call, by the hook that runs once the call has finished. It is kept per session, and per lane when the session works in a worktree.

It records facts, not opinions:

- The RAG queries the session made, and the files each one returned.
- The source files and the test files the session edited.
- The cards whose pull request was merged and are not yet moved on the board, and the cards it closed.
- Whether each file was clean or already changed when the session first touched it.
- How many times in a row the end of the turn was blocked, and when the Sentinel stepped aside.

## Why it exists

The gates need to know what happened in the session. The only other source is the agent, and the agent says what it believes: "I checked the RAG", "I added tests". The ledger is written by a hook, from what the tools actually did, so a gate can check a fact instead of trusting a sentence.

## When it acts

It is written after every tool call and never blocks one. Several checks read it:

| Who reads it | What for |
|---|---|
| The RAG check, before an edit | The file being edited (or one in its directory) came back in one of the session's queries. |
| The discard check, before a `git` command | A file that was already changed before the session touched it may be your work: it is not discarded. |
| The board check | A merged card has to be moved before the session goes on. |
| The end of the turn | Sources edited on the base branch or with no test touched, cards not moved, the count of blocks in a row. |
| `kj review` | Every source in the diff was answered by a RAG query. The files those queries returned and the diff does not touch go to the reviewer by name: the same idea may live there too. |

For `kj review`, in a lane the queries of every session of that lane count together (one lane is one card). In the main tree only the most recent session counts, so a new task cannot lean on queries made days ago for another one.

## How you use it

You do not write it, and neither does the agent: the files under `.karajan/harness/` are the supervisor's, and the Sentinel blocks any edit to them from the session.

- `kj sentinel status`: prints what the ledger holds for the session and any violation the end of the turn would block on.
- If `kj review` finds the hooks on disk differ from the ones your installed kj writes, it does not trust the ledger and rejects until you run `kj harden` again.

## What it does not do

- **It is not the audit record.** It is working state, local and never committed (kj keeps it out of git). The record of what the gates decided is the decision log, `.karajan/policy-decisions.jsonl`, chained by hash so a broken chain shows.
- **It does not store your code or your prompts.** It holds file paths, card ids, counters and the first 200 characters of each RAG query.
- **It is not shared.** Each machine and each lane has its own; a teammate's session does not count for yours.
- **It does not exist without the Sentinel.** Only the Sentinel's hooks write it, and they run in Claude Code. In a tree with no Sentinel installed, `kj review` says there is no ledger to check instead of assuming one.
