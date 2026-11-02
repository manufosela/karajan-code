# atril plugin machinery lives in the shared .rulesync with entries owned in the ledger

Status: accepted
Date: 2026-11-02 (accepted 2026-11-02)

## Context

Plugins bring hooks and MCP servers that other CLIs must receive too (P10, P15). Writing them needs a JSONC-aware edit of settings files and a way to run an MCP server that uses plugin variables. Issue #2430, step 13e.

## Decision

Accepted by the maintainer: write plugin hooks and MCP entries through the shared .rulesync, each entry owned in the ledger so sync and remove only touch what atril wrote.

Still open, to be decided separately: whether to add the jsonc-parser dependency (it needs the maintainer's explicit OK) or to edit JSONC by hand, and how an MCP server that uses plugin variables is launched.

## Consequences

One path for every CLI and an exact undo. The two open points block the code that edits JSONC settings and the code that launches an MCP server; they do not block the principle. jsonc-parser would add a dependency if it is accepted. No code that edits JSONC or launches an MCP server starts before both points are decided.
