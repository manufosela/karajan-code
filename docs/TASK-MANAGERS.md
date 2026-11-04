# Writing a task manager

A task manager is the place where a project keeps its stories (HUs): GitHub Issues, Linear, your own tool.
karajan-code talks to it through one small contract, so a manager is a package that anyone can write.
This is the guide; the copyable starting point is [`packages/story-contract/template/`](../packages/story-contract/template/).

## The contract

Depend on `@karajan-family/story-contract` alone (it imports nothing from karajan-code). A manager offers four operations, each returning an `Hu`:

| Operation | What it does |
|---|---|
| `create({ title, acceptanceCriteria, tests, ref })` | makes a `pending` story |
| `list()` | every story |
| `move(id, status)` | changes the status and reads the story back |
| `claim(id, who, { release })` | says who holds the story |

An `Hu` has `short_id`, `title`, `status`, `claimed_by` and `ref`. Optional parts: `isId(ref)`, `canonicalId(ref)` and `idHint` (the id format of your system; the core never assumes `HU-<n>`). Required: `capabilities` (`acceptanceCriteria: field|body`, `dependencies: none|partial|graph`, `assignee`, `verdicts: pr|comment|none`, `offline`) and `credentials` (names of environment variables, `[]` when none). `assertManager(manager)` fails loud on anything missing.

The core also uses `manager.write.move`, `manager.write.claim` and `manager.assertNotHeld`, but they are optional optimisations, not part of the contract or of `assertManager`: `write` skips the read-back after a write, and `assertNotHeld` is a cheaper "held by someone else" check. Without them the core uses `write = { move, claim }` of the contract, and reads the card through one `list()` to refuse a running card held by someone else (`HuClaimedError`).

## The factory

The package exports `createManager({ config, env, run })`: `config` is your block of `board.yml`, `env` the environment, `run` an injectable command runner. The registry also passes `projectDir` and `board`. See `packages/board-github/src/index.js`.

## What the core promises

- **Offline cache and queue.** `list` is cached on every answer; when the service does not answer, the cache is read and a move is queued, then applied in order when it answers again. A move the service refuses is reported and dropped, never forced. Creating offline is refused: an id is only ever minted by your service.
- **Mirror.** Each read rewrites a read-only plan so the HU Board can show the stories.
- **Claim race rule.** A running story held by someone else moves only with an explicit release.
- **Errors by name.** The core recognises errors by `err.name` (`isOffline`, `isRefusal`), never by `instanceof`.

## What your manager must provide

- **Opaque ids.** The id is what your service gave; the core hands it back as it got it.
- **The three errors**, from `@karajan-family/story-contract`: `BoardOfflineError` (could not reach the service: the core may queue), `BoardRejectedError` (it answered and said no), `HuClaimedError` (held by someone else).
- **A read-back after every write.** `move` returns what the service now says, and throws `BoardRejectedError` if it disagrees.
- **Exactly one status per story.** Zero or several is a `BoardRejectedError`, not a guess.
- **Credentials only from the environment.** List the variable names in `credentials`. Never put a secret in `board.yml` (the core refuses keys named like `key`, `token`, `secret`, `password`) and never in an error message.

## Test it

`@karajan-family/story-contract/suite` (tests only, needs `vitest`) runs the shared behaviour against your manager:

```js
import { runStoryContract } from "@karajan-family/story-contract/suite";

// makeManager() returns { manager, backend }: your manager and a fake of your service
// with rejectMoves() and corrupt(shortId, n) to provoke the refusals.
runStoryContract("my manager", makeManager);
```

The template's test is `tests/hu/manager-template.test.js`; `packages/board-github/tests/github-story-contract.test.js` does the same with `gh` faked.

## Naming

`@karajan-family/board-<name>` is for managers of the family; the community is suggested `kj-board-<name>`. Both are conventions, not checked by code.

## Turn one on in a project

`kj hu backend <github | linear | local>` writes `.karajan/board.yml`; you can also edit it. The file has `backend` and a block named like the manager, for example:

```yaml
backend: linear
linear:
  team: ENG
  label: kj:hu
  states: { pending: Todo, running: In Progress, done: Done, failed: Canceled, skipped: Canceled }
```

For GitHub it is `backend: github` with `repo: owner/repo`. The block is passed to `createManager` as `config`.

## Loading a community manager: the allowlist

A manager is code that runs with the agent's rights and sees its credentials, so a community manager loads only when `.karajan/board.yml` lists it, at an exact version:

```yaml
backend: acme
acme: { workspace: w }      # the block named like the backend, passed to createManager as config
managers:
  allow:
    - { name: kj-board-acme, version: 1.2.3 }
```

- The backend name is the package name without the `@scope/` and a leading `board-` or `kj-board-` (`@x/kj-board-acme` answers to `acme`). Two entries for one backend, and a name that would shadow `github`, `linear` or `local`, are errors; the built-in managers always load first.
- `name` is an npm package name and `version` an exact version (no ranges, no tags).
- **kj never installs.** Install the package yourself (`npm install --save-exact <name>@<version>`). It is resolved from the project; if it is missing or its installed version is not exactly the listed one, kj refuses and says why.
- **An installed package that is not listed is never run**: kj does not import it.
- The module must export `credentials` (the variable names it needs) and `createManager`. It receives only those variables in `env`; values are never printed.
- The result must pass `assertManager`. The shared conformance suite is not run at load time, because it cannot run against a real service.
- `kj doctor` shows the allowlist, the loaded manager and its version, its capabilities and its missing credentials; a refusal shows the reason and the fix.
- A change to `allow` goes through a pull request like a dependency.

## Not verified

- `@karajan-family/story-contract` is a workspace package here; I could not confirm it is published to npm, so the template's `^0.1.0` dependency is the version in this repo.
- The second built-in manager, Linear (`packages/board-linear`), has no `manager.js` yet in this tree: only its client and config.
