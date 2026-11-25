---
title: "Lanes: one task, one worktree"
description: Why kj gives each task its own git worktree, how to open, list and close a lane, and what the Sentinel enforces about them.
---

A lane is a git worktree of your repo, with its own branch, that holds one task. Two sessions never share a tree: each works in its own lane.

## Why lanes exist

On 2026-08-08 two sessions worked on the same tree in the middle of a release. A release commit landed on the other session's branch and a push uploaded an empty branch, because neither session saw the whole git state. Merging the family of repos into one monorepo would have multiplied those collisions, so the physical lane per session came first (MONO-0, ADR 0002).

## Open, list and close a lane

```sh
kj worktree start <slug>
kj worktree list
kj worktree done <slug>
```

- `kj worktree start <slug>` creates the worktree, cuts the branch `feat/<slug>` from `origin/<base>` and bootstraps the dependencies. `--base <branch>` cuts the lane from `origin/<branch>` and keeps that branch as the lane's base for the size check, `kj check` and the review gate.
- `kj worktree list` shows the active lanes. With `--json` it adds each lane's commits ahead of the base and the cards its branch names; with `--json --prs` it also adds each lane's PR.
- `kj worktree done <slug>` removes the lane and deletes its branch when it is merged into the base. It refuses to remove a lane with uncommitted changes unless you pass `--force`, which also deletes the branch even if it is not merged.

To check that you are in a lane and not in the main checkout, `git rev-parse --git-dir` must differ from `git rev-parse --git-common-dir`.

Where git ignores the operator's local config (`.karajan/kj.config.yml` and `rules.local.yml`), every lane links it to the main checkout's copy, so there is one and no per-lane copy (a plain copy where a symlink is not allowed). A tracked config belongs to the branch and is never replaced. See the [operating contract](/docs/guides/operating-contract/).

The full list of options is in the [command reference](/docs/v4/commands/).

## What the Sentinel enforces

The [Sentinel](/docs/guides/sentinel/#cross-lane) judges each write by the lane of the path it touches (ADR 0034). For Edit and Write that is the worktree that contains the file. For Bash it is every path the command names, resolved from the session's directory (unless the host sandbox already confines `.kj/worktrees`).

- **One live session per lane.** A write is refused, with the reason, when another live session holds that lane: one that started there or one that switched into it (ADR 0033). A session that writes in a lane renews its presence mark there, and a lane it stops writing in is released after the idle period. A lane another live session wrote in during the last 30 minutes is refused.
- **One session can hold several lanes.** It carries several tasks in parallel, one mark per lane. Two sessions never write in the same lane.
- **Each write is judged with its own lane.** Its branch, its card and its supervisor are the lane's, not the session's start checkout.
- **Reading is free.** Any session can read any lane.
- **Mutations it cannot verify are refused.** That includes `cd` in a mutator chain, command substitution, shell expansion, and redirections whose target hides behind a variable. Use `git -C`, `npm --prefix` and literal paths (this applies where the host sandbox does not already confine the lanes).

## What a person can still do

There is no escape for the agent (ADR 0015). A deliberate crossing between lanes, or a write the guard refuses, is yours: do it in your own terminal, outside the session.
