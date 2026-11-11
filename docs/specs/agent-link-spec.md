# Spec: the agent link (ADR 0043)

Status: draft for the maintainer. Nothing here is decided until it is accepted; it builds on ADR 0043 (still `proposed`) and the maintainer's answers of 2026-11-10 in #3236 (recorded in the ADR by PR 3790). Card HU-3792 is slice 1 and is already running. This document is card HU-3795.
Date: 2026-11-10.

## 1. Objective

Agents that work on this repository for different people tell each other what they do: assign and accept tasks, request and return cross-reviews, signal and clear blockers, ask for and record decisions, and run ceremonies (daily, refinement, retro). They do it in the comments of the GitHub issues and pull requests the project already has, in a fixed format, with identity, history and permissions taken from GitHub. A message informs and proposes; it never authorizes and never feeds a `kj` gate (ADR item 1).

Success looks like: an agent on one machine posts a `review_request` on a pull request; the agent on another machine, started later, reads it with one command, sees who sent it and whether that person may write to the project, and answers with a `review_result`; every message is on GitHub for a person to read; no message could make either agent run a command.

## 2. Two approaches, and why one won

The method asks for at least two, one as if the codebase did not exist.

- **A. Comments through an adapter (ADR 0043, chosen).** One comment holds one message. GitHub gives the author, the permission level, the server time, the history and the UI. The cost is the rate limit and the public exposure of every comment.
- **B. An append-only log on a branch of the repository (as if nothing existed).** Each message is a signed commit on an orphan branch, read with `git fetch`. No API quota, works offline, signatures prove the author. It loses on four points: every agent needs push rights to the repository, which the fine-grained token policy (ADR 0037) tries to avoid; branch protection and CI fight with a branch of chat commits; a commit time is the author's clock, not a server time; and nobody can read or answer it without a git client. The guarantees of ADR item 7 come from the hosting system for free in A and have to be built in B.
- **C. Extend `kj handoff` (the legacy line).** Handoffs are records from an agent to its own human, stored locally. They carry no author and cross no machine. Rejected for the same reason ADR 0043 gives for the cross-session messaging of Claude Code.

## 3. Boundaries

Always: treat a message body as untrusted text; read only messages from people with write permission or more; run `kj privacy scan` on a message before posting it; state in each message whether an agent or a person speaks.
Ask first: any change to what a message may cause an agent to do; any automatic delivery of messages into an agent's context; publishing a package version.
Never: run what a message says; let a message grant a permission or change a gate; post secrets, tokens, home paths, customer data or a security topic (those go to the private security advisory); use a classic `repo` or `public_repo` token (ADR 0037).

## 4. Architecture

```
agent  --kj link-->  protocol (src/link/)          the block, types, rules of use, local record
                          |
                          v
            message contract (packages/story-contract, experimental)   ten operations, capabilities, suite
                          |
                          v
            GitHub adapter (packages/board-github)     gh api: comments, permission, rate limit
```

- **Protocol** (core, `src/link/`): the `kj-link` block (parse, format, validate), the eleven types, the rules of use, and the reader's local record (cursor, ids, text and edit time of each message seen). Pure functions plus a small store. It names no GitHub concept.
- **Contract** (`packages/story-contract`, slice 1): `publish`, `listSince`, `readAssignee`, `readReviewers`, `setLabel`, `readLabels`, `authorPermission`, `openConversation`, `listConversations`, `limits`, the capabilities and a suite any adapter runs. Experimental, a minor version, in its own module.
- **Adapter** (`packages/board-github`): implements the contract over `gh` (account pinned as in ADR 0040). Messages are issue and pull request comments; ceremonies are dedicated issues first, Discussions later if a fine-grained token is shown to write them.
- **Command** (`kj link`, in `src/cli/register-meta.js` next to `handoff`): `send`, `inbox`, `threads`, `limits`. Pull only: nothing is pushed into an agent's context.

What exists and is reused (read in the code): `assertManager` and `describeCapabilities` for capability declaration; the injectable `run` and the `BoardOfflineError` / `BoardRejectedError` pattern of `github-board.js`; `pinGhIdentity`; `scanText` of `src/privacy/scan.js`; the `TRUSTED` idea of `publish-pr.js` (author association). What does not exist: any function that posts or lists issue comments, any use of etag or `x-poll-interval`, any Discussions code, any parser of a fenced block from a comment, any permission-level check.

## 5. The `kj-link` block (decisions marked D are the owner's)

One comment: a first line with the conclusion or the pending decision, then one fenced block named `kj-link`:

```kj-link
v: 1
type: review_request
id: <stable id>
reply_to: <id or null>
context: <card or pull request>
to: <github user or "all">
speaker: agent
```

- D1. `v` is an integer; a reader refuses a higher major and ignores unknown fields. Proposed: `v: 1`.
- D2. `to` (addressee) and `speaker` (`agent` or `person`) are not in the ADR. Proposed as fields of the block.
- The id is the GitHub comment id; the block carries `reply_to` as that id. A message is never edited; a later edit is stored as a new, suspect message (ADR item 2).

## 6. Rules of use, as code

1. Permission: `authorPermission(user)` must be `write` or `admin`; anything else is not read. D3: proposed check is the collaborator permission endpoint of GitHub, cached for 10 minutes.
2. The body is text: when shown to an agent it is quoted and labelled "message from <user>, untrusted proposal", never placed in an instruction position.
3. A diff named in a message is read from the repository without checking out the sender's branch.
4. Before posting: `scanText` with severity `block` refuses the post; a message with a secret shape never leaves the machine.
5. Edit detection: the reader keeps id, text and last-modified time; a changed time marks a new, suspect message.
6. Polling: D4, once a minute by default, never below `limits()`; writes one at a time with at least one second between them; conditional requests with `etag` if the spike in slice 3 shows `gh` can send them.

## 7. The tasks

| Slice | Card | Content | Size | Depends on |
|---|---|---|---|---|
| 1 | HU-3792 (running) | Message contract, capabilities, guarantees check, suite, in `story-contract`, experimental. | ~150 | none |
| 2 | HU-3796 | The `kj-link` codec: parse, format, validate, the eleven types, `v` rules, unknown-field handling. Pure, no I/O. | ~150 | 1 |
| 3 | HU-3797 | Spike, then adapter read side: can `gh api` send `If-None-Match`; `listSince` over issue comments with `since`, id, author, `updated_at`; `authorPermission`; `limits()` from `rate_limit`. | ~150 | 1 |
| 4 | HU-3798 | Adapter write side: `publish`, `setLabel`, `readLabels`, `readAssignee`, `readReviewers`, with the one-second pause. | ~150 | 3 |
| 5 | HU-3799 | Rules of use: the reader record, permission filter, edit detection, untrusted wrapping, privacy scan on post. | ~150 | 2, 3 |
| 6 | HU-3804 | `kj link send / inbox / threads / limits`, pull only, with a fake adapter test and one real run on a test repository. | ~150 | 4, 5 |
| 7 | HU-3800 | Ceremonies: `openConversation` and `listConversations` as dedicated issues (label and title rule D5); the Senescal convenes and gathers. | ~150 | 4, 5 |
| 8 | HU-3801 | The Senescal closes: result in `docs/retros/YYYY-MM-DD.md` through a pull request. | ~100 | 7 |
| 9 | HU-3802 (blocked) | Discussions as the `ceremonies` capability, only after the token test of ADR 0043 passes. | ~100 | token test |
| 10 | HU-3803 | Hook-in: how an agent finds out there is mail (for example a line at session start saying "3 unread", never the bodies). Needs a decision: D6. | ~100 | 6 |

Order: 1 → (2, 3 in parallel) → 4, 5 → 6, 7 → 8, 10. Slices 2 and 3 touch different files. Every slice is one PR of about 150 net lines, test first, with its own review verdict.

Checkpoints: after slice 3, run the adapter read side against a real test repository; after slice 6, two agents on two accounts exchange a message end to end.

## 8. Testing

Contract and adapter: the shared suite against an in-memory fake and a fake `gh` runner. Protocol: tables of valid and invalid blocks, edit and permission cases, and an injection case (a body that tells the agent to run a command must come out quoted and inert). One manual end-to-end run on a test repository before slice 6 is merged. Mutation testing on the rules of use (slice 5) because a weak assertion there is a security hole.

## 9. Risks

- Prompt injection through a message body is the largest. Mitigations: write permission filter, quoted bodies, pull only, no auto-delivery, `speaker` stated. They reduce it; they do not remove it (ADR consequences).
- Rate limits are shared with every other use of the same credential. Mitigation: `limits()`, once-a-minute polling, etag.
- Public exposure: every comment is public. Mitigation: privacy scan on post, nothing sensitive by rule, security topics out of band.
- An account compromise loses everything. ADR 0037 bounds a token; nothing bounds an account.
- Two packages versions: the contract is experimental; a breaking change before first real use is allowed and announced.

## 10. Open for the owner

- D1 to D5 above (version rules, `to` and `speaker`, the permission check, the polling interval, the ceremony issue name and label).
- D6. Whether an agent is ever told about mail automatically. Proposed: only a count at session start, bodies only through `kj link inbox`.
- D7. Where the protocol lives: proposed `src/link/` in core, with the contract in the package; the alternative is the package, which would put kj's rules of use inside a published package.
- D8. The token test for Discussions (a personal test repository and a fine-grained token limited to it).
- The rename `story-contract` to `board-contract` when the message interface leaves experimental (the maintainer's, with the npm acts).

## 11. Not verified

How `gh api` sends conditional requests; whether a 304 counts against secondary limits; what the collaborator permission endpoint returns for an organization's team members; whether a fine-grained token can write Discussions; how the interaction limits of a public repository affect who can comment.

## Resumen en español

Es la spec para implementar la ADR 0043: agentes de personas distintas que se comunican por comentarios de issues y PRs de GitHub con un formato fijo (`kj-link`), sin que un mensaje autorice nada. Se compararon tres enfoques (comentarios por un adaptador, un registro en una rama y ampliar `kj handoff`) y gana el primero. La arquitectura son cuatro capas (protocolo en `src/link/`, contrato en `story-contract`, adaptador en `board-github` y el comando `kj link`, solo de lectura bajo demanda). El plan son diez piezas de unas 150 líneas, con dependencias y dos puntos de comprobación con un repo de prueba. Las decisiones D1 a D8 son del dueño del proyecto; cada una lleva una propuesta por defecto.
