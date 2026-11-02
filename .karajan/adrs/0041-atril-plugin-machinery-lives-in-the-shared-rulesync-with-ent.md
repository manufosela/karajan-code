# atril plugin machinery lives in the shared .rulesync with entries owned in the ledger

Status: proposed
Date: 2026-11-02

## Context

Plugins bring hooks and MCP servers that other CLIs must receive too (P10, P15). Writing them needs a JSONC-aware edit of settings files and a way to run an MCP server that uses plugin variables. Issue #2430, step 13e.

## Decision

PROPOSED, needs the user: write plugin hooks and MCP entries through the shared .rulesync, each entry owned in the ledger so sync and remove only touch what atril wrote. Open: add the jsonc-parser dependency (explicit OK needed) or edit JSONC by hand; how an MCP server that uses plugin variables is launched.

## Consequences

One path for every CLI and an exact undo. Costs a dependency if jsonc-parser is accepted. No P10 code before this is accepted.
