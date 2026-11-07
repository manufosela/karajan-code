# @karajan-family/board-github

GitHub Issues as a task manager for karajan-code. Each story is an issue of the repo:
its number is the id (`HU-<n>`), its state a `kj:<status>` label, and who holds it the assignee.

Since 1.1.0 it keeps each story's tier (story-contract's `tier` capability): a
`kj:tier:<trivial|standard|deep>` label, which anyone can change on the board, and a
`Tier: <level> - <reason>` line in the body. The label wins: when someone changes it, the
reason in the body no longer applies and the story is listed with `reason: null`.

## What it needs
- The `gh` CLI, authenticated (`gh auth login`): it holds the login, so the manager asks for no credentials.
- The repo as `owner/repo`.

## Use
```js
import { createGithubManager } from "@karajan-family/board-github";

const manager = createGithubManager({ repo: "acme/app" });
await manager.create({ title: "Add login", acceptanceCriteria: ["A user can sign in"] });
```
`run` can be injected to replace the `gh` runner (tests, offline fakes).

## Contract
It fulfils `@karajan-family/story-contract` and passes the shared suite (`runStoryContract`) with `gh`
faked in memory: see `tests/github-story-contract.test.js`. The functions it wraps (`createHu`,
`listHus`, `setStatus`, `claim`, `assertNotHeld`) are exported too.

It carries a temporary copy of the board errors (`src/board-errors.js`) until `story-contract` is published; check them by `err.name` (`isOffline`/`isRefusal`), never by `instanceof`.

To write a manager of your own, see [docs/TASK-MANAGERS.md](../../docs/TASK-MANAGERS.md).

## Turn it on in a project
A project whose board is shared through GitHub Issues sets its board to GitHub with the repo
(`owner/repo`) in its karajan config; `kj hu add|list|move` then work on the issues.

## Tests
`npm test` inside the package.
