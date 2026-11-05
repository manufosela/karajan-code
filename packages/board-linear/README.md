# @karajan-family/board-linear

Linear as a task manager for karajan-code, over Linear's GraphQL API (`https://api.linear.app/graphql`).

It implements the story contract (`create`, `list`, `move`, `claim`) and is loaded by `kj hu` when
`board.yml` says `backend: linear`. `createManager({ config, env, fetch })` is the uniform entry point;
`createLinearManager({ config, apiKey, fetch })` takes the key directly.

```yaml
backend: linear
linear:
  team: TRI            # the team key; ids look like TRI-123
  label: kj:hu         # optional, this is the default
  states: { pending: Todo, running: In Progress, done: Done, failed: Canceled, skipped: Backlog }
  users: { alice: alice@acme.test }   # kj identity -> Linear email
```

How it works:
- `create` resolves the team and its states, finds or creates the label (once per run), and opens the
  issue with a markdown body (`## Acceptance criteria`, `## Tests`, `Ref:`). The id is the Linear identifier.
- `list` pages the team's labelled issues and maps each state name back to a kj status; a state that
  maps to none is read by its Linear type (see "States that are not in `linear.states`").
- `move` writes the state and reads it back; `claim` sets the assignee and reads it back. Both refuse an
  issue without the label.
- `claim` takes an identity from `linear.users` or a direct email; anything else is a loud error.
- `kj hu move <id> running` with an identity Linear cannot resolve (not in `linear.users`, or an email
  with no Linear user) still moves the card, but leaves it **unassigned** and warns:
  `⚠ <id> was not assigned: ... add it to linear.users: { "<who>": "<linear email>" }`. An explicit
  `claim` call, or a `kj hu move --release`, by that identity still fails with the same hint.
- A running issue held by someone else needs `claim(ref, who, { release: true })` to be taken over.
- **Last writer wins.** Linear has a single assignee, so two simultaneous claims leave the later write;
  the other claimant finds the winner on read-back and gets the held error.

## Verified against the real API
Run on 2026-11-04 against a test team of a private workspace (everything it created was deleted). Verified:
- `create` with `labelIds` and `stateId`, and the label created with `teamId`.
- `list` by team key and label, and the label filter.
- `claim` by email with `assigneeId`.
- `move` with `stateId` and the read-back.
- The refusal of an issue without the label (nothing is written).
- The states of a team.

Not verified: the maximum page size of `issues` (`first: 50` works).

## Statuses and Linear states
- Linear's built-in `Duplicate` cannot be used for a kj status: Linear only accepts it with a duplicate relation to another issue.
- The defaults written by `kj hu backend linear` are `pending: Todo`, `running: In Progress`, `done: Done`, `failed: Canceled`, `skipped: Backlog`: five distinct states, so every status reads back as itself.
- `skipped` is `Backlog` because it exists in every standard Linear team, needs no relation and differs from `failed`. A run against the real API moved a card there and read it back as `skipped`.
- Two statuses may still share one state. `move` checks the read-back by state name, and `list` reads a shared state as the first status in the order `pending, running, done, failed, skipped`.

## Behaviour seen against the real API
- A `list` right after a `create` can miss the new issue for a moment: the search index lags. A direct read of the issue always sees it. Seen in two of three runs.
- A card with the kj label that is moved by hand to a state that is not in `linear.states` is read by the Linear type of that state (see below), so `kj hu list` never drops a card because someone moved it by hand.

## States that are not in `linear.states`
A state named in `linear.states` always wins over its type. Any other state is read by its Linear type:

| Linear type | kj status |
| --- | --- |
| `triage`, `backlog`, `unstarted` | `pending` |
| `started` | `running` |
| `completed` | `done` |
| `canceled` | `failed` |

A state of any other type maps to no status: `list` leaves that card out and warns `<id> is in the Linear state "<name>" of type "<type>", which maps to no kj status: it is left out`. `move` and `claim` refuse such a card with an error naming the card and the state; they do not guess.

## What it needs
- A personal API key in the `LINEAR_API_KEY` environment variable. It is sent as the `Authorization`
  header and never appears in an error, a log or `board.yml`.
- A `linear` block in `board.yml`: `team` (the team key), `label` (default `kj:hu`), `states` (the Linear
  state name for each of `pending`, `running`, `done`, `failed`, `skipped`) and an optional `users` map
  from kj identity to email. `validateConfig` fails loud on a missing field, an unknown key or a key
  that looks like a credential.

## Errors
Network failure, HTTP 5xx and rate limits (HTTP 429 or `RATELIMITED`, with the `Retry-After` seconds) are
offline errors; a refused key (401/403), an answer with `errors`, or the held error of `claim` is a
refusal. Check them by `err.name` (`isOffline`/`isRefusal`), never by `instanceof`.

| Situation | Error |
| --- | --- |
| `LINEAR_API_KEY` missing | rejected, names the variable and never a value |
| key refused (401/403) | rejected, `Linear refused the key (HTTP <status>)` |
| `move` or `claim` on a state of an unknown type | rejected, names the issue and the state |
| issue without the label | rejected by `move` and `claim`; nothing is written |
| identity without a `linear.users` entry and not an email | rejected, `no Linear user mapped for <who>: add it to linear.users: ...` (a `move running` starts it unassigned and warns) |
| email unknown to Linear | rejected, `no Linear user with the email <email>` |
| team lacks the state for a status | rejected, `the Linear team has no state "<name>"` |
| running issue held by someone else | held error, unless `release` is passed |

## Tests
`npm test` inside the package. The client runs against an injected `fetch`: no network, no key.
