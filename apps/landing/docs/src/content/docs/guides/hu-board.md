---
title: HU Board Dashboard
description: Web dashboard for visualizing Karajan Code user stories and sessions.
---

## What is the HU Board?

A web dashboard that visualizes all HU stories and pipeline sessions managed by Karajan Code. It provides a kanban board, session timeline, quality scores, and multi-project support.

## In practice — from your agent

Beyond the kanban, the board has a **Governance** view — the project's hash-chained ledger, live. Every decision the environment makes (a deny, an exception with its expiry and scope, a review verdict, a supervisor reseal) lands there sealed, and each entry carries the cryptographic fingerprint of the one before it. So while your agent works, you can read — in a browser, no terminal — exactly what was decided and by whom, and be sure nobody rewrote yesterday's record without it showing.

Parallel work shows too. A card worked in a `kj worktree` lane carries a badge with the lane, its branch, its commits ahead of the base and its PR. The Governance view lists the lanes outside the method: a branch that names no card, and a lane whose PR is already merged, with the exact `kj worktree done <slug>` that clears it. All of it is read from git every time, nothing is stored.

## Under the hood — try it yourself

The ledger is a plain append-only file where every line links the last:

```sh
cat .karajan/policy-decisions.jsonl   # one JSON decision per line; each carries a "prev" hash
kj policy report                      # the same, as a readable report (a broken chain exits 1)
kj policy anchor                      # re-verify the WHOLE chain and seal its head-hash into git
```

Once the head-hash is committed (`kj policy anchor` writes `.karajan/policy-anchor.json`), rewriting the past means rewriting the repo's history too — and that shows.

## Quick Start

### Without Docker
```bash
cd $(npm root -g)/karajan-code/packages/hu-board
npm install
kj board start
```

### With Docker
```bash
cd $(npm root -g)/karajan-code/packages/hu-board
docker compose up -d
```

### From the CLI
```bash
kj board start    # Start the dashboard
kj board stop     # Stop it
kj board status   # Check if running
kj board open     # Open in browser
```

## Configuration

Enable in `kj.config.yml`:
```yaml
hu_board:
  enabled: true
  port: 4000
```

Or enable during setup:
```bash
kj init  # Select "Enable HU Board" when prompted
```

## Features

- **Kanban Board**: Stories in columns (Pending → Certified → Coding → Done)
- **Quality Scores**: 6-dimension scores with visual progress bars
- **Session Timeline**: Stage-by-stage breakdown with durations
- **Multi-Project**: Auto-discovers all projects from ~/.karajan/
- **Auto-Sync**: Watches JSON files for real-time updates
- **Dark Theme**: Matches Karajan Code design
- **Port Fallback**: Starts on port 4000 by default; automatically tries 4001–4009 if the primary port is busy
- **Lanes and Governance**: each card shows its lane, branch, commits ahead and PR; the Governance view lists lanes outside the method

Up to 4.x the board could also launch the `kj run` pipeline (the **Run plan** button). That pipeline was retired in 5.0: see [Migrating to 5.0](/docs/v4/migration/).

### Start a card from the board (▶)

Each pending card without a lane has a ▶. After you confirm, the board runs `kj hu start <id> --code` in the project:

1. kj checks the card. If it does not exist or someone else holds it, nothing is created.
2. It opens the card's lane `feat/<id>-<slug>` from `origin/<base>`, with your identity and the Sentinel already in it.
3. It moves the card to running, reserved to you.
4. The coder declared in your panel writes the card there (`kj code --card <id>`), and its log opens in the board.

Reviewing and committing stay with you or your agent, inside the lane. A card that already has a lane is not started again: the board tells you where it is. From the terminal, the same is `kj hu start <id> [slug]`, with `--code` to have the coder write it.

## How It Works

The board reads JSON files from `~/.karajan/hu-stories/` and `~/.karajan/sessions/`. SQLite is used as an index for fast queries — if deleted, it rebuilds from the JSON files on next startup.

## Shared board

A team can work on one board: its HUs live as GitHub Issues of the repo (label `kj:hu`) and everyone sees the same ones.

- **Turn it on**: `kj hu backend github` writes `.karajan/board.yml` with the repo of `origin`. That file goes in a PR; whoever pulls inherits it.
- **Work with it**: `kj hu list` reads it, `kj hu move <HU> <status>` changes an HU. Each HU is assigned to whoever has it in progress.
- **See it in the board**: the project shows a `github` plan with those HUs and a notice explaining it is the shared board, with a link to its issues. It is read-only from the web: the issues are the truth, and `kj hu move` changes them.

## MCP Tool

Available as `kj_board` MCP tool:
```
kj_board({ action: "start", port: 4000 })
kj_board({ action: "open" })
kj_board({ action: "status" })
kj_board({ action: "stop" })
```
