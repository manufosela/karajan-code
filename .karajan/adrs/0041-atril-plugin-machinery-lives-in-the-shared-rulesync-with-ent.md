# atril plugin machinery lives in the shared .rulesync with entries owned in the ledger

Status: accepted
Date: 2026-11-02 (accepted 2026-11-02, amended 2026-11-02, amended 2026-11-03, amended 2026-11-04)

## Context

Plugins bring hooks and MCP servers that other CLIs must receive too (P10, P15). atril merges them into the source files of the shared .rulesync (mcp.json and hooks.json, or mcp.jsonc and hooks.jsonc when those exist) and rulesync generate copies them to every other CLI. atril never edits the configuration files of a CLI. Issue #2430, step 13e.

## Decision

Accepted by the maintainer: write plugin hooks and MCP entries through the shared .rulesync, each entry owned in the ledger so sync and remove only touch what atril wrote.

Amended by the maintainer. The two points that were open are closed.

Import through rulesync. atril does not write the hooks and MCP entries of a plugin by hand. It runs `rulesync import --targets claudecode-plugin --features mcp,hooks --output-root <copy of the plugin in the store>` in a temporary directory with its own .rulesync/, reads the canonical files with JSON.parse and merges their entries into the project's .rulesync/hooks.json and .rulesync/mcp.json, owned in the ledger by plugin name. The import never writes to the project's .rulesync/. Reason: the canonical format is not the one of a Claude plugin, and the import writes whole files without merging.

No jsonc-parser. atril reads and writes .rulesync/mcp.json and .rulesync/hooks.json, the files the rulesync repository itself uses, with the JSON.parse and JSON.stringify of Node. It touches only its own entries, keyed by the plugin name in the ledger. Entries the user wrote stay as they are. If neither the .json nor the .jsonc file of a kind exists, atril creates the .json.

If mcp.jsonc or hooks.jsonc exists, it wins over the .json according to rulesync, so atril acts on it and never writes to the .json, which would be ignored. atril reads the .jsonc with JSON.parse. If it holds comments or trailing commas, atril fails with a clear error and does not rewrite it. If a real use with comments appears, this ADR is reopened.

No launcher. atril never calls or runs a hook or an MCP server and builds no wrapper such as atril mcp run or atril hook run. rulesync copies them to each CLI, and each CLI invokes them natively when it starts, resolving paths and reading environment variables itself. Any restart of a CLI is outside atril.

Hook commands that point to a script of the plugin are written as the store path (./.karajan/plugins/<name>/<version>/...). On install atril warns that the team must run atril sync to have those copies. .gitignore is not touched.

If rulesync is not installed and the plugin brings hooks or MCP servers, atril installs the skills, commands and agents, writes no entries and says what was left out and how to complete it. A plugin without hooks or MCP never mentions rulesync.

After install and remove, atril runs rulesync generate only if the project turned on the opt-in (rulesync.generate: true); otherwise it prints the command.

The user_config secrets of a plugin are never written in clear text to .rulesync. They are referenced as ${VAR} in env or headers, with no value.

Removing a plugin deletes its entries from the ledger and from .rulesync, and its skills, commands and agents from the atril store. The next rulesync generate removes them from the other CLIs.

Amended by the maintainer on 2026-11-04 (implemented in PR 3374, HU-3358). A project without .rulesync gets the minimal folder after the user confirms. When a plugin brings hooks or MCP servers and the project has no .rulesync/, atril creates it with only what it needs: the folder, hooks.json and/or mcp.json, and the ledger .owners.json. The confirmation is the one of the install: `--yes` is the answer; with no terminal and no `--yes` it is the dry run, which writes nothing. Declining creates nothing. atril never creates the example files of `rulesync init`. The install says `created .rulesync/ (it did not exist)`. Removing the last plugin leaves the folder alone. This replaces any earlier reading that a project without .rulesync gets only the Markdown, or is told to run `rulesync init`.

## Consequences

One path for every CLI, an exact undo and no new dependency. The code that writes the entries can start. Verified in the current rulesync documentation, not pinned to a repo version: mcp.jsonc and hooks.jsonc are the recommended paths and accept comments and trailing commas; mcp.json and hooks.json stay readable; the .jsonc wins when both exist; the rulesync repository itself uses .json without comments. Assumed and not verified: how rulesync declares the cwd of an MCP server; which rulesync version the project uses; that a second rulesync import would replace the whole canonical file (inferred from the code, not run). The first entry written checks these, and this ADR is amended again if any differs.
