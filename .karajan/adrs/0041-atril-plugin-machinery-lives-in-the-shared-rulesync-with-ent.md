# atril plugin machinery lives in the shared .rulesync with entries owned in the ledger

Status: accepted
Date: 2026-11-02 (accepted 2026-11-02, amended 2026-11-02)

## Context

Plugins bring hooks and MCP servers that other CLIs must receive too (P10, P15). atril writes them to the source files of the shared .rulesync (mcp.json and hooks.json, or mcp.jsonc and hooks.jsonc when those exist) and rulesync generate copies them to every other CLI. atril never edits the configuration files of a CLI. Issue #2430, step 13e.

## Decision

Accepted by the maintainer: write plugin hooks and MCP entries through the shared .rulesync, each entry owned in the ledger so sync and remove only touch what atril wrote.

Amended by the maintainer. The two points that were open are closed.

No jsonc-parser. atril reads and writes .rulesync/mcp.json and .rulesync/hooks.json, the files the rulesync repository itself uses, with the JSON.parse and JSON.stringify of Node. It touches only its own entries, keyed by the plugin name in the ledger. Entries the user wrote stay as they are. If neither the .json nor the .jsonc file of a kind exists, atril creates the .json.

If mcp.jsonc or hooks.jsonc exists, it wins over the .json according to rulesync, so atril acts on it and never writes to the .json, which would be ignored. atril reads the .jsonc with JSON.parse. If it holds comments or trailing commas, atril fails with a clear error and does not rewrite it. If a real use with comments appears, this ADR is reopened.

No launcher. atril registers a hook or an MCP server the way rulesync prescribes. rulesync copies it to each CLI, and each CLI resolves the path and reads environment variables natively. atril builds no wrapper such as atril mcp run.

The user_config secrets of a plugin are never written in clear text to .rulesync. They are referenced as ${VAR} in env or headers, with no value.

Removing a plugin deletes its entries from the ledger and from .rulesync, and its skills, commands and agents from the atril store. The next rulesync generate removes them from the other CLIs.

## Consequences

One path for every CLI, an exact undo and no new dependency. The code that writes the entries can start. Verified in the current rulesync documentation, not pinned to a repo version: mcp.jsonc and hooks.jsonc are the recommended paths and accept comments and trailing commas; mcp.json and hooks.json stay readable; the .jsonc wins when both exist; the rulesync repository itself uses .json without comments. Assumed and not verified: how rulesync declares the cwd of an MCP server, how a hook script that lives outside the project is addressed, and which rulesync version the project will use. The first entry written checks these, and this ADR is amended again if any differs.
