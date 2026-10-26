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

The entry exports `search`, `resolve`, `resolveBlock`, `install`, `remove`, `expose`, `unexpose`, `persistentPieces`, `sync`, `generate`, `catalogSync`, `installFromCatalog`, `importSkills`, `MARKER` and `VERSION`.

## License

MIT
