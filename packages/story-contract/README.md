# @karajan-family/story-contract

The contract a task manager (GitHub Issues, Linear, your own) fulfils so karajan-code
can keep its stories there. Depend on this package alone: it imports nothing from karajan-code.

## What a manager offers

Four operations, each returning a story (`Hu`):

- `create({ title, acceptanceCriteria, tests, ref })`
- `list()`
- `move(id, status)` (reads the story back after writing)
- `claim(id, who, { release })`

Optional: `isId(ref)`, `canonicalId(ref)` and `idHint`, the id format of the manager.
Required: `capabilities` (what it can show and manage) and `credentials` (the environment
variables it needs, `[]` when none). `assertManager(manager)` fails loud on anything missing.

The package also exports the errors a manager raises: `BoardOfflineError`,
`BoardRejectedError`, `HuClaimedError`, `isOffline` and `isRefusal`.

## Test your manager

`@karajan-family/story-contract/suite` is for tests only (it needs `vitest`):

```js
import { runStoryContract } from "@karajan-family/story-contract/suite";

// makeManager() returns { manager, backend }: your manager and a fake of its service
// with rejectMoves() and corrupt(shortId, n) to provoke the refusals.
runStoryContract("my manager", makeManager);
```

Writing a manager? Read [docs/TASK-MANAGERS.md](../../docs/TASK-MANAGERS.md) and copy [`template/`](template/).

## Versions

A change that breaks a manager that passes today's suite is a major version.
