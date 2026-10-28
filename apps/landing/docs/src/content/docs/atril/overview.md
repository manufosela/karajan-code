---
title: 'Overview'
description: 'What atril is, how its store works and when to use it.'
---

<!-- synced-from: manufosela/karajan-code@e8dffc272bdde0f63ca56059209b5791232e611b:packages/atril/README.md · section-sha256: 16e80fb68fdc4a126a0b4fce189b96284dc4e1eae9982a3b2bbd6d026fbdc89f
     DO NOT EDIT BY HAND — regenerated with `npm run sync:family-docs` -->

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
