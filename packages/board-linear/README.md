# @karajan-family/board-linear

Linear as a task manager for karajan-code, over Linear's GraphQL API (`https://api.linear.app/graphql`).

**Status: part 1.** This release has the HTTP client, the config validation and the error helpers. The
manager itself (create, list, move, claim, and the shared story-contract suite) comes in part 2.

## What it needs
- A personal API key in the `LINEAR_API_KEY` environment variable. It is sent as the `Authorization`
  header and never appears in an error, a log or `board.yml`.
- A `linear` block in `board.yml`: `team` (the team key), `label` (default `kj:hu`), `states` (the Linear
  state name for each of `pending`, `running`, `done`, `failed`, `skipped`) and an optional `users` map
  from kj identity to email. `validateConfig` fails loud on a missing field, an unknown key or a key
  that looks like a credential.

## Errors
Network failure, HTTP 5xx and rate limits (HTTP 429 or `RATELIMITED`, with the `Retry-After` seconds) are
offline errors; a refused key (401/403) or an answer with `errors` is a rejected error. Check them by
`err.name` (`isOffline`/`isRefusal`), never by `instanceof`.

## Tests
`npm test` inside the package. The client runs against an injected `fetch`: no network, no key.
