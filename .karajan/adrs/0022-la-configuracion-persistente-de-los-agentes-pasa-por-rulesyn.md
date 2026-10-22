# Persistent agent configuration goes through rulesync

Status: accepted
Date: 2026-10-22
Accepted: 2026-10-22, by the maintainer
Related: ADR 0021 (atril)

## Context

Every CLI keeps its own copy of what each session must carry — rules, MCP servers, hooks,
permissions — in its own place and format (`CLAUDE.md` and `.claude/settings.json`,
`AGENTS.md` and `.codex/config.toml`, `opencode.json`, `.agents/rules/`, …).
[rulesync](https://github.com/dyoshikawa/rulesync) keeps one source in `.rulesync/` and
compiles it out to ~40 CLIs, translating formats and hook events.

Karajan already writes through it: when a project uses rulesync, `kj` puts its method and
guidelines in `.rulesync/rules/karajan.md` instead of `CLAUDE.md` / `AGENTS.md`, and runs
`rulesync generate` only when the project declared `rulesync.generate: true`, with the
local binary or `npx --no-install`, never a package fetched on the fly
(`src/utils/rulesync.js`).

atril (ADR 0021) adds a second writer: its bridge and router rule, the artifacts the user
installs permanently, and the hooks and MCP servers of the plugins it installs. Two writers
in one source need rules to live together.

## Decision

1. **Two lifetimes.** What every session of every agent must carry is **persistent** and
   goes through rulesync: rules, MCP servers, hooks, permissions, and the skills, commands
   and subagents the user chose to install permanently. Everything else is **on demand** and
   stays in atril's store (ADR 0021); it never enters `.rulesync/`.
2. **One source.** In a project that uses rulesync, `.rulesync/` is the only source of
   persistent configuration. No writer edits a generated file (`CLAUDE.md`, `AGENTS.md`,
   `.claude/`, `.codex/`, …) directly; a change made there is lost on the next generate.
3. **Ownership.** Each writer — the user, Karajan's core, atril — owns what it wrote:
   - **Per-file features** (rules, commands, subagents, skills): the file belongs to its
     writer and carries that writer's marker. A writer's own pieces are named after it
     (`rules/karajan.md`, `rules/atril-router.md`, `commands/atril.md`); what it installs on
     the user's behalf keeps the artifact's name (`commands/kj-review.md`) or, from a plugin,
     `<plugin>__<name>`. A writer never edits or removes a file it did not write; a name clash
     is an error that names both.
   - **Managed blocks.** Where a writer shares a file with the user — kj's method and
     guidelines in `rules/karajan.md`, which teams extend with their own rules — the writer
     owns its managed blocks, not the file: each block is a ledger entry keyed
     `<path>#<block>` (`rules/karajan.md#guidelines`), and the text outside them stays the
     user's.
   - **Single-file features** (`hooks.json`, `mcp.jsonc`, `permissions.jsonc`): each entry
     belongs to its writer. A writer adds, changes or removes only its own entries; an entry
     with no owner is the user's. Keys: an MCP server by its name (`mcp:<server>`), a
     permission by its rule (`permissions:<rule>`), and a hook, which sits in an array under
     its event, by an `id` field the writer sets on it (`hooks:<event>:<id>`, e.g.
     `hooks:preToolUse:atril/<plugin>/<hook-id>`).
   - **The ledger**, `.rulesync/.owners.json`, records every owned file and entry:
     `{ "version": 1, "entries": { "<feature>:<key>": { "owner": "atril", "hash": "…" } } }`.
     It is the single source of hashes; a file's marker only names its writer. It is
     committed, and written atomically (temp file and rename) under a lock file
     (`.rulesync/.owners.lock`), so `kj` and atril never interleave.
   - An entry or file whose hash no longer matches the ledger was edited by hand: the
     writer stops and reports it instead of overwriting. `kj rulesync adopt|release <key>`
     and `atril rulesync adopt|release <key>` settle it: adopt takes the current content as
     the writer's, release hands it to the user.
   - **Upgrade.** A file that carries a writer's marker but has no ledger entry (written
     before the ledger existed) is claimed by that writer on its first run, once, and
     reported.
4. **Generation is whole, so its order does not matter.** Whoever runs `rulesync generate`
   runs it with one set of canonical arguments, the same for every writer:
   `rulesync generate --targets * --features *` (what `src/utils/rulesync.js` runs today),
   over the whole source, never a subset. The output is then a function of `.rulesync/`
   alone: `kj` and `atril` may both run it, in any order, with the same result.
   - The only carve-out is a generate over a source that is not the project's `.rulesync/`
     and writes only to its own output root, never a shared output: atril's derived plugins
     (ADR 0021, point 14).
   - The existing opt-in stays: a writer runs it only when the project declared it
     (`rulesync.generate: true` in `kj`'s config, `rulesync.generate: true` in `atril.json`
     for atril; each reads only its own), with the local binary or `npx --no-install`. Otherwise it says which command to run.
   - CI can prove the generated files are current by generating and failing on a diff.
5. **Projects without rulesync.** `kj init` and `atril init` offer to adopt it (`rulesync
   init`, then `rulesync import` of the CLI files already there) and ask; nothing is adopted
   without the user's answer. Before the import, each writer takes its own managed blocks out
   of the CLI files (`kj` its method and guidelines block in `CLAUDE.md` / `AGENTS.md`) and
   writes them as its own files, so the user's imported rules never duplicate them. If the user declines, `kj` keeps writing its rules
   straight into the agent files as today; atril keeps working on demand but cannot install
   anything persistent (the bridge, permanent artifacts, plugin machinery) and says so.
6. **rulesync is pinned.** `karajan-code` and `@karajan-family/atril` declare the rulesync
   range they were tested with; `kj doctor` and `atril doctor` report a version outside it.

## Alternatives considered

- **Each writer edits each CLI's files.** No dependency, but every writer would carry
  every CLI's paths and formats, and the writers would overwrite each other.
- **A separate family module for persistent configuration.** It may come, but today its
  only logic would be the ownership ledger and the generate call, with two consumers that
  already need both. Revisit when the ledger grows behaviour of its own.
- **One designated runner of `rulesync generate`.** Avoids running it twice, but a
  generate over the whole source is idempotent, so a single runner buys nothing and adds a
  coupling between `kj` and atril.

## Plan

In atomic PRs of ~150 net LOC, each with its tests (one PR per step):

1. The ownership ledger: read, write atomically under the lock, verify hashes; per-file and
   single-file entries; the format version.
2. `kj` writes `rules/karajan.md` through the ledger, claiming the existing file once;
   generate keeps today's canonical arguments.
3. `kj rulesync adopt|release`.
4. The adoption offer in `kj init` (`rulesync init` + `rulesync import`, kj's blocks taken
   out first), asked, never assumed.
5. The rulesync range check in `kj doctor`.

atril uses the same ledger from its own package (ADR 0021, plan steps 8, 9 and 13): the format is
this ADR's contract, not shared code, so atril stays isolated.

## Open questions

- Whether the ledger format should be proposed upstream to rulesync, so any tool can share a
  `.rulesync/` source the same way.
