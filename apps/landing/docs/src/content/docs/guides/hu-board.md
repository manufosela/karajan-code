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

## How It Works

The board reads JSON files from `~/.karajan/hu-stories/` and `~/.karajan/sessions/`. SQLite is used as an index for fast queries — if deleted, it rebuilds from the JSON files on next startup.

## MCP Tool

Available as `kj_board` MCP tool:
```
kj_board({ action: "start", port: 4000 })
kj_board({ action: "status" })
kj_board({ action: "stop" })
```
