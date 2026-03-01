---
title: Architecture Overview
description: High-level architecture of Karajan Code.
---

:::note
This page is under construction. Full content coming soon.
:::

## Module Structure

Karajan Code is organized as a Node.js CLI application with the following key modules:

- **`src/process.js`** — Main pipeline orchestrator
- **`src/agents/`** — Agent registry and adapters (Claude, Codex, Gemini, Aider)
- **`src/sonar/`** — SonarQube integration (API, Docker management, scanner)
- **`src/session/`** — Session management (create, resume, pause, cleanup)
- **`src/plugins/`** — Plugin discovery and loading
- **`src/utils/`** — Shared utilities (retry, fs, paths, git)
- **`templates/roles/`** — Markdown templates for each pipeline role

## Inspirations

The architecture has been influenced by [jorgecasar/legacy-s-end-2](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration), which uses a clean hexagonal architecture with ports and adapters for AI orchestration.
