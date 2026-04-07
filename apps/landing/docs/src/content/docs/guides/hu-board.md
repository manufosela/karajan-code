---
title: HU Board Dashboard
description: Web dashboard for visualizing Karajan Code user stories and sessions.
---

## What is the HU Board?

A web dashboard that visualizes all HU stories and pipeline sessions managed by Karajan Code. It provides a kanban board, session timeline, quality scores, and multi-project support.

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
  auto_start: true  # Start automatically on kj run
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
- **Auto-Generated HUs**: Since v1.38.0, the board displays automatically generated HUs from complex tasks — not just manually provided ones. When triage activates hu-reviewer for medium/complex tasks, the decomposed HUs appear on the board with their sub-pipeline state (pending/coding/reviewing/done/failed/blocked)
- **Plan Sync (v2.5.0)**: HUs generated via `kj plan` are also tracked on the board. When you run `kj run --plan <planId>`, the board shows each HU's sub-pipeline state in real time, grouped by their originating plan
- **Acceptance Tests (v2.4.0+)**: Each HU card shows its executable acceptance tests and their pass/fail status after each coder iteration
- **Port Fallback**: Starts on port 4000 by default; automatically tries 4001–4009 if the primary port is busy
- **Pipeline History**: History records are generated for all pipeline runs, providing full traceability across tasks and their HU decompositions

## How It Works

The board reads JSON files from `~/.karajan/hu-stories/` and `~/.karajan/sessions/`. SQLite is used as an index for fast queries — if deleted, it rebuilds from the JSON files on next startup.

## MCP Tool

Available as `kj_board` MCP tool:
```
kj_board({ action: "start", port: 4000 })
kj_board({ action: "open" })
kj_board({ action: "status" })
kj_board({ action: "stop" })
```

## Auto-Start

The board starts automatically when:
- `hu_board.auto_start: true` is set in `kj.config.yml`
- `kj run` generates an auto-HU batch for a complex task

In both cases the board is started before pipeline execution begins, so stories appear on the board as soon as the first HU enters the pipeline.
