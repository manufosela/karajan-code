# atril

Skills, commands and subagents for every AI CLI, on demand.

An agent loads every skill and command it finds when a session starts, and each one costs context whether the task needs it or not. atril keeps them in a **store** instead, finds the ones a task needs, and hands back the files to read. Claude Code, Codex, OpenCode and any CLI that reads Markdown can use the same store.

atril is a module of the [Karajan](https://karajancode.com) family. It imports nothing from Karajan: Karajan calls it exactly as any other project would.

## Install

```sh
npm install -g @karajan-family/atril
atril --version
```

Node.js 22.12 or later.

## The store

A store is a folder with one directory per kind, the layout the CLIs already use:

```
.atril/
  skills/<name>/SKILL.md      a skill: a folder, so it can carry references
  commands/<name>.md          a command
  agents/<name>.md            a subagent
  atril.json                  the store's config
```

Every artifact is Markdown with frontmatter, and declares at least `name`, `description` and `kind`:

```markdown
---
name: review
description: Review a pull request for correctness and risk
kind: command
---
Read the diff, then...
```

The root is `.atril/` by default; `--root <dir>` or `ATRIL_ROOT` change it (Karajan uses `.karajan/`). A user-level store in `~/.atril` (or `ATRIL_USER_ROOT`) is read too; the project's artifact wins a clash.

## Find and use

```sh
atril scan                      # what the stores hold
atril search "flaky test"       # ranked hits, installed and available
atril route "fix the flaky login test" --role coder
```

`atril route` resolves a task into a **block**: the best artifact plus what it `uses` (and the agents it `delegates` to, as subagents), ordered so each piece comes after what it depends on, within a budget. It prints the files to read, not their content. `atril enrich` completes each artifact's frontmatter with the relations it discovers, and `atril graph` shows them.

## Install and remove

```sh
atril install ./my-skill        # a local skill folder, command or agent file
atril install skill:lint        # an artifact a catalog offers (see below)
atril remove command:review
```

An install is validated first, refuses symlinks, and never overwrites different content.

## Catalogs

A catalog lists what you can install without installing it. List catalogs in `atril.json`:

```json
{ "catalogs": ["vendor/kit", "catalogs/team.json"] }
```

Each entry is either a folder in a store's layout, or a JSON file of git sources, each pinned to a commit with a note on what it is for:

```json
{
  "sources": [
    { "source": "owner/repo/skills", "commit": "<40-character sha>", "note": "process skills" }
  ]
}
```

Sources use the OpenSkills form `owner/repo[/path]`, read as GitHub repositories.

```sh
atril catalog sync              # fetch every pinned source into the cache, once
atril search lint               # catalog hits come back with installed: false
atril install skill:lint        # install one, from its pinned commit
```

The fetch runs no hooks, lands symlinks as plain files and verifies the commit. Skills installed by OpenSkills into `.claude/skills` or `.agent/skills` move into the store with `atril import --from openskills`.

### Marketplaces of plugins

A catalog can also be a plugin marketplace: any catalog folder that holds `.claude-plugin/marketplace.json`, either a directory catalog or a git source pinned and fetched with `atril catalog sync`. Nothing new goes in `atril.json`:

```json
{ "catalogs": ["../my-marketplace"] }
```

Its plugins are indexed from the files already on disk, with no fetch and nothing installed. They show up in `atril search` as `kind: plugin`, `installed: false`, with the catalog they come from; `--kind plugin` lists only them:

```sh
atril search tdd --kind plugin
```

The first catalog that lists a plugin name wins it. A marketplace entry that cannot be read is skipped with a warning on stderr; an unreadable `marketplace.json` stops the search and names the catalog. `atril route` leaves plugins out of what it proposes.

```sh
atril install plugin:kit          # lists what the plugin holds on stderr, asks [y/N]
atril install plugin:kit --yes    # skips the question
atril install plugin:kit --json   # prints the install result on stdout
```

`atril install plugin:<name>` installs a plugin's Markdown (skills, commands, agents) into the store and its npm packages into the plugin cache. The trust listing and the question go to stderr; with no terminal and no `--yes` it is a dry run that writes nothing (the same as `atril update`). Hooks, MCP servers and `bin/` executables are not installed yet: they are listed on stderr and under `notInstalled` in `--json`. `--yes` and `--json` only apply to `plugin:<name>`.

### The recommended set

atril ships a set of artifacts it recommends, bundled in the package. It is always the first catalog, before the ones in `atril.json`, so it works offline and versions with atril. Nothing in it is installed on its own:

```sh
atril recommended               # each entry: available, on-demand, persistent or changed
```

`changed` means the installed artifact differs from the one this version of atril ships. `ATRIL_RECOMMENDED` points atril at another set.

## The lockfile

`atril.lock.json` sits in the store root (`.atril/atril.lock.json`, or under whatever `--root` or `ATRIL_ROOT` names). It records, per `kind:name`, where each installed artifact came from and a hash of its content:

```json
{
  "version": 1,
  "artifacts": {
    "skill:lint": {
      "origin": "catalog",
      "catalog": "catalogs/team.json",
      "source": "owner/repo/skills",
      "commit": "<40-character sha>",
      "hash": "sha256:<64 hex characters>"
    }
  }
}
```

- `origin` is `catalog` (installed from a catalog, with its `catalog`, and for git sources the `source` and pinned `commit`), `import` (moved in with `atril import`, with `from`) or `local` (installed from a path).
- `hash` covers the artifact's content. For a command or agent, enrichment (the `atril:` block) is not content; for a skill, every other file in its folder is.
- It holds no timestamp and no local path, and it is written deterministically, so **commit it**: the team shares one record of what is installed and from where, and diffs stay small.
- `atril install`, `atril import` and `atril update` write it; `atril remove` drops the entry. Reading never writes: a missing lockfile is an empty one, and a malformed entry fails loudly with the file and entry named.

`atril status` and `atril update` read it.

## Status

```sh
atril status                    # one line per artifact, then a summary
atril status --check            # for CI: exit 1 on edited or missing
atril status --json             # the rows as a JSON array
```

`atril status` compares the store with the lockfile. Each artifact is in one state, the first that holds:

| State | Meaning |
|---|---|
| `missing` | in the lockfile, gone from disk |
| `edited` | its content differs from the recorded hash |
| `uncurated` | not in the lockfile, or its origin is no longer a configured catalog (`local` and `import` are never curated) |
| `ok` | none of the above |

Lines are `state`, `kind:name` and the origin, separated by tabs, followed by a summary such as `3 ok, 1 edited, 0 missing, 1 uncurated`; an empty store prints `nothing installed`. With `--json` each row is `{ kind, name, state, origin }`. `--check` exits 1 only for `edited` or `missing`, so `uncurated` artifacts do not fail CI. `--root <dir>` picks the store. Status is read-only.

## Update

```sh
atril update                    # ask, per outdated artifact, whether to update it
atril update skill:lint         # only the named artifacts
atril update --yes              # apply every outdated one, skip edited ones
atril update --yes --discard-edits
atril update --json
```

`atril update` brings the artifacts installed from a catalog up to what that catalog offers now. (`atril catalog update` is the one that moves a git source's pinned commit; `atril update` then moves your copies.) It prints each pending artifact with its diff, then:

- **With a terminal**, it asks `update <kind:name>? [y/N]` for each one. For an artifact you edited locally, the question warns that the edit will be lost.
- **`--yes`** applies every outdated artifact and skips the edited ones, unless `--discard-edits` is also given, which overwrites them.
- **Without a terminal and without `--yes`**, it is a dry run: it prints the diffs, applies nothing and exits 0.
- **`--json`** prints `{ updates, applied }`: every artifact's state (`current`, `outdated`, `edited` or `unavailable`) and the refs that were updated.

An update replaces the copy atomically: if copying fails, the previous version stays. A named `kind:name` with no catalog origin in the lockfile fails before anything is applied. `atril init` reports a recommended artifact that changed in this version and tells you to run `atril update`.

## Persistent pieces through rulesync

CLIs only accept slash commands they know. atril registers **one** in each CLI, the bridge `/atril <name or task>`, plus a router rule that tells the agent to ask atril before a task. Everything else stays on demand, unless you choose to expose it permanently:

```sh
atril expose command:review     # recorded in atril.json
atril sync                      # write the bridge, the rule and the exposed artifacts
atril sync --check              # for CI: exit 1 while .rulesync/ is out of date
```

`atril sync` writes into [rulesync](https://github.com/dyoshikawa/rulesync)'s sources (`.rulesync/`), owning only what it wrote through rulesync's ownership ledger: a hand edit, a file of yours or another writer's entry stops it with nothing changed. With `"rulesync": { "generate": true }` in `atril.json` it then runs `rulesync generate`, which spreads the pieces to every CLI.

## MCP server

```sh
atril mcp --root .atril
```

Serves `search`, `resolve`, `install` and `remove` as MCP tools over stdio. The store is fixed when the server starts; a tool call never chooses it.

## API

```js
import { search, resolve, install, sync, catalogSync } from "@karajan-family/atril";

const { block, available } = resolve({ task: "fix the flaky login test", role: "coder", root: ".atril" });
```

The entry exports `search`, `resolve`, `resolveBlock`, `install`, `remove`, `status`, `expose`, `unexpose`, `persistentPieces`, `sync`, `generate`, `catalogSync`, `catalogUpdates`, `applyCatalogUpdate`, `installFromCatalog`, `importSkills`, `recommended`, `applyRecommended`, `detectPluginFormat`, `listPluginMarkdown`, `readPluginManifest`, `MARKER` and `VERSION`.

`status({ root })` returns the rows `atril status --json` prints. `search` returns marketplace plugins as hits of kind `plugin`; `plugins: false` leaves them out.

## License

MIT
