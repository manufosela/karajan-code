---
title: 'With the family'
description: 'How Karajan Code uses atril: kj init installs its commands into .karajan/, the /atril bridge, atril sync, and what kaRAGan and the HU board add around it.'
---

atril works on its own (see the [overview](../overview/)). Karajan Code depends on it and uses it as the store for its own commands.

## What `kj init` does

`kj init` installs Karajan's `kj-*` commands into the atril store under `.karajan/` (`.karajan/commands/`), **on demand**: they are not copied into `.claude/commands/` or any other CLI folder, so they do not occupy context until an agent asks for them. Running it twice leaves the store untouched (`unchanged`).

## The `/atril` bridge

CLIs only accept slash commands they know. atril registers a single one in each CLI, the bridge `/atril <name or task>`, plus a router rule that tells the agent to ask atril before starting a task. Karajan's commands, and anything else in the store, are reached through that bridge.

## `atril sync` from kj

When the project already uses [rulesync](../integrations/), `kj init` runs `atril sync --root .karajan` for you: it writes the bridge and the router rule into `.rulesync/` and, if `rulesync.generate: true` is declared in `.karajan/atril.json`, generates the files for every CLI. Without rulesync, kj installs the commands, tells you to run `rulesync init` and then `atril sync --root .karajan`, and stops there: nothing persistent is written.

## What kaRAGan and the HU board add

- [kaRAGan](../../karagan/) indexes the project, so an agent answers with `kj rag query` instead of guessing what the code does.
- The HU board (`kj hu`) holds the cards each piece of work belongs to.

atril decides **which** command or rule reaches the agent; kaRAGan and the board decide **what** the agent knows and **what** it is working on.
