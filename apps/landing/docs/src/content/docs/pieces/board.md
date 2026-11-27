---
title: The board and the cards
description: Every piece of work has a card before it starts, and the branch names it. What it is, why it exists, when it acts, how you use it and what it does not do.
---

## What it is

A card is a unit of work: a title, acceptance criteria and a state (`pending`, `running`, `done`, `failed`, `skipped`). The HU Board is where kj keeps them. By default it is local to your machine; with `kj hu backend github` each card is also a GitHub issue of the repository (labelled `kj:hu`), and kj also knows Linear.

A card can point to its copy in another tracker with `--ref` (Planning Game, Jira, Linear...), and it can say how much model it needs with `--tier trivial|standard|deep`, which is the model `kj code` uses to write it.

## Why it exists

Work with no card has no edges. Nobody can say what was asked, what "done" means, or whether a change belongs to it. With an agent this is worse: it starts on something, drifts into something else, and the history no longer explains why a line changed.

A card gives the work a statement and criteria before it starts, and the branch that names the card ties every commit to it. The board is also how you see what the agent is doing without asking it.

## When it acts

| Moment | What happens |
|---|---|
| **Before the first edit** | The Sentinel does not let the agent edit source on `main`, or on a branch whose name carries no card id. |
| **Before the review** | `kj review` rejects a diff on a branch with no card. |
| **After a merge** | When a pull request merges, its card has to be moved. Until it is, the Sentinel does not let the agent commit, open or merge another pull request. |
| **At the end of the turn** | The agent does not stop while the cards it took are still waiting, unless it says why it stops with a reason kj can check. |

## How you use it

- `kj hu add "<title>" --ac "<criterion>"` creates a card. `kj hu list` lists them, `kj hu move <id> <state>` moves one.
- `kj hu start <id>` opens a lane for it (a worktree with its own branch) and moves it to `running`.
- `kj board start` opens the board in your browser, at `http://localhost:4000` by default. It listens only on your machine.

## What it does not do

- **It does not decide what to build.** You or your tracker do; the card records it.
- **It does not check that the work matches the card.** That the change fulfils the criteria is for the tests and the [cross review](/docs/pieces/cross-review/).
- **With the GitHub backend, the issue is as public as your repository.** Keep secrets and personal data out of card titles.
- **It does not count JSON, TOML or Markdown as source** for the card-first check: editing docs on a branch with no card is not blocked.
