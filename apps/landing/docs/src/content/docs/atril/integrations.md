---
title: 'rulesync and MCP server'
description: 'Persistent pieces through rulesync and the atril MCP server.'
---

<!-- synced-from: manufosela/karajan-code@2030b52dd4ffa815e271be2341d40620b8627084:packages/atril/README.md · section-sha256: 6d4ab0511acef9c7d082f75a2de9b49af6f7291fd39dee1f57c90e338b6b879e
     DO NOT EDIT BY HAND — regenerated with `npm run sync:family-docs` -->

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
