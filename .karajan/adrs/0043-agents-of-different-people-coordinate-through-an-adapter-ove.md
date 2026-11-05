# Agents of different people coordinate through an adapter over their git system, GitHub first

Status: proposed
Date: 2026-11-02

## Context

Agents that work on one repository for different people talk to each other today in free text. A message proves nothing about who sent it, whom it is for or what it may touch. A reply from another session reads like a human's answer and is not one. Teams need a shared format for requests, answers, pending decisions and reports.

The use case: the agent on one maintainer's machine and the agent on another's share tasks, cross-review diffs, tell each other what they are doing and help with blockers, as people on a team do. Projects may host their code on systems other than GitHub, so the protocol cannot depend on one of them.

What exists: the shared board lives in GitHub issues (ADR 0025). ADR 0029 makes the work state layer a set of connectors that each declare their capabilities, with one source of truth per project. `kj review --publish-pr` posts verdicts on pull requests. `kj handoff` and the phone signature (ADR 0018) cover acts that need a human. The agent works with a token that holds only the permissions its work needs (ADR 0037), and `kj` pins the `gh` account of the repository for its own calls (ADR 0040). In the code, the board backend is a two-value list (`github`, `local`) in `src/hu/board-config.js`, and `src/hu/github-board.js` holds plain functions (`createHu`, `listHus`, `setStatus`, `claim`) that call `gh`. There is no shared interface for a git provider. Nothing covers agent-to-agent messages.

## Decision

Proposed, not accepted. The decision has two layers: a protocol that does not depend on any git system, and an adapter per system. GitHub is the first adapter.

## The protocol (independent of the git system)

1. **The link informs and proposes. It never authorizes.** Acts with power (merge, publish, accept an ADR, install a dependency, change permissions) stay in `kj` with its own signature (ADR 0018) or in the human's own system. No message is an input to a `kj` gate or verdict.
2. **Message format.** One comment holds one message: a first line with the conclusion or the pending decision, then one fenced block named `kj-link` with typed fields (`v`, `type`, `id`, `reply_to`, `context`, and the fields of the type). The vocabulary comes from A2A: tasks, states and messages. A message is never edited. The reader stores the message id, its text and its last-modified time, and treats a later edit as a new, suspect message.
3. **Message types.** `assign`, `accept`, `decline`, `review_request`, `review_result`, `blocker`, `blocker_help`, `blocker_cleared`, `status`, `decision_needed` and `decision`. A `decision` only says what a human decided; it grants nothing. Ceremonies (daily, refinement, retro) are conversations of their own, with one kind per ceremony.
4. **Rules of use.**
   - The agent processes only messages whose author has collaborator permission on the project, checked by permission and not by name. Anyone else's messages are not read.
   - The body of a message is untrusted text and is handled as a proposal. It is never run as an order.
   - A diff is read from the repository without checking out the sender's branch.
   - A message states whether an agent or a human speaks. The reader cannot verify it, because the agent writes with its human's account.
   - Never in a message: secrets, tokens, environment variables, home paths, `~/.karajan`, sensitive `user_config` of atril, customer data, or logs that have not passed `kj privacy scan`.
   - The adapter's credential has only the permissions that reading and writing messages need (ADR 0037).
   - Security or critical topics never go in a message of the link, and never in a summary in a document of the repository either, because the repository is public. An agent that finds one does not post it: it takes it to the private security advisory of the repository, the channel `kj` already uses; the fix is prepared there and a public pull request and release follow as soon as it is ready.
5. **No cryptography and no infrastructure of our own.** Identity, transport and history come from the git system.

## The adapter contract

6. **Operations.** An adapter offers these, in terms of the project and not of any system:
   - `publish(thread, message)` returns the message id, its author and the server time.
   - `listSince(thread, cursor)` returns the new messages in order, each with its id, author, creation time, last-modified time and body, and a new cursor.
   - `readAssignee(card)` and `readReviewers(change)` with the review state of each.
   - `setLabel(card, label, on)` and `readLabels(card)`.
   - `authorPermission(user)` returns `none`, `read`, `write` or `admin` for the project.
   - `openConversation(kind, title)` returns a thread for a ceremony, and `listConversations(kind)`.
   - `limits()` returns the minimum polling interval, the minimum pause between writes and the quota left.
7. **Guarantees the system must give.** A stable message id; a server-side time; an authenticated author; a way to see that a message changed after it was posted; a permission level per user; and a way to restrict who can write to collaborators. An adapter that cannot give `authorPermission`, a stable id or a server time cannot be used, because the rules of use depend on them.
8. **Capabilities.** Each adapter declares what it supports: `tasks` (an assignee), `reviews` (requested reviewers and review states), `labels`, `ceremonies` (a native thread with categories), `notice` (a push channel), and `edit_history`. The protocol degrades when one is missing: ceremonies become comments on a dedicated card; a missing label becomes a field of the block; reviews become comments on the change. The declaration is shown when the adapter is selected, as ADR 0029 does for the board.
9. **What belongs where.** The protocol owns the block, the types, the vocabulary and the rules of use. The adapter owns the API, the credential, the limits, the polling or push mechanism and the native equivalents of each type. Nothing in the contract names a concept of one system: a label, an assignee and a thread exist in the others, while a "discussion category", a "pull request" and an "App" are the GitHub adapter's own terms.
10. **One connector layer (open, waiting for the maintainer).** The proposal is that the adapter contract of this ADR is shared with the story connectors of the board (ADR 0029). What exists, verified in the repository, and was endorsed by the maintainer in issue #3332 ("the contract, the GitHub and Linear managers and the community packages are exactly the direction"): `packages/story-contract` holds the four operations (`create`, `list`, `move`, `claim`), the board errors, the capabilities, the credentials and a shared suite; `packages/board-github` and `packages/board-linear` are merged; a Planning Game manager was started by the maintainer (card KJC-TSK-1417); and community manager packages load through an allowlist. Whether the message operations of this ADR (`publish`, `listSince`, `readAssignee`, `readReviewers`, `setLabel`, `readLabels`, `authorPermission`, `openConversation`, `listConversations`, `limits`) join that same layer as a second contract is not decided. It waits for the maintainer's answer in #3236. The publication of verdicts on pull requests still calls `gh` directly. This ADR changes no code.

## The GitHub adapter

11. **It talks to GitHub through the `gh` CLI**, as the rest of the board does (`github-board.js`, `kj review --publish-pr`), with the authentication that `gh` already has and the account that `kj` pins for the repository (ADR 0040).
12. **Transactional messages** are comments on the issues and pull requests of the project repository, which is already the board.

| Type | In GitHub |
|---|---|
| `assign`, `accept`, `decline` | The assignee of the card (ADR 0025), and a reply comment |
| `review_request`, `review_result` | The requested reviewer of the pull request and its review state; findings are review comments by `file:line` |
| `blocker`, `blocker_help`, `blocker_cleared` | A `blocked` label and a comment with the cause on the first line; cleared when the label goes |
| `status` | One comment per agent on the card or on a tracking issue |
| `decision_needed`, `decision` | Comments |

13. **Ceremonies (daily, refinement, retro).** A ceremony is a conversation not tied to one task. The GitHub adapter puts each one in a GitHub Discussion, one category per type, when it declares the `ceremonies` capability. Otherwise it uses a dedicated issue per ceremony, with the messages as comments. It declares `ceremonies` only when its credential is a fine-grained token or App that can write Discussions, with no classic `repo` or `public_repo` token. That is not verified (see "Not verified"), so the first implementation uses issues. Discussions are public in a public repository. The piece that organizes the ceremonies and the feedback between agents is named **the Senescal** (name and duties from the maintainer's comment of 2026-11-05 in #3236). It is a piece of the method, like the Sentinel or the Steward, and not the whole messaging protocol: only the facilitator. Its first two duties: it convenes a retro or a feedback session, opening its conversation and telling the team's agents; and it gathers and orders what each agent brings (what went well, what did not, what it learned from the others).
13a. **The result of a ceremony goes to the repository.** The Senescal closes the ceremony: it writes the result (conclusions, agreed improvements, decisions) as a document under `docs/` (for example `docs/retros/YYYY-MM-DD.md`), through a pull request like any other change. So it is versioned, reviewed and indexed by the RAG, which indexes the files the repository versions. The wiki of the git system is not used: it is a separate repository the RAG does not index. A result document is context and never a rule: it authorizes nothing (item 1), and rules enter through `CLAUDE.md` and `kj rules`. The Senescal's last duty: it decides nothing and grants nothing. It proposes improvements; a new rule still enters only through `CLAUDE.md` and `kj rules`, approved by the person (item 1).
14. **Credentials (decided by the maintainer: ADR 0037 stands).** The agent works only with fine-grained tokens limited to what its work needs: for issues and pull requests, Issues and Pull requests only; `gh` takes one through `GH_TOKEN`. No classic `repo` or `public_repo` token, for Discussions or for anything else. Discussions are used only if a fine-grained token or App can write them; until that is proven, ceremonies use issues (item 13). A GitHub App has its own limited permissions and its messages carry the App's identity and not the human's, but its private key sits on the machine where the agent can read it (ADR 0037) and the App must be created, installed and rotated; it can be considered later if Discussions turn out to be needed.
15. **Polling, not push.** The machines of the agents cannot receive webhooks, so the adapter polls. It sends writes one at a time with a pause of at least one second. GitHub's documentation says that a conditional request with `etag` in `if-none-match` returns 304, and that a 304 does not count against the primary rate limit when the request is authenticated; it asks the client to wait at least `x-poll-interval` when the header is present. The `gh api` page does not mention conditional requests, so how the adapter sends them is not verified. Documented limits: 5,000 requests per hour for a user token; 100 concurrent requests; 900 points per minute for REST, where a `GET` costs 1 and a `POST` costs 5; about 80 content-creating requests per minute and 500 per hour. A poll once a minute costs about 60 requests an hour.
16. **Privacy (decided by the maintainer).** In a public repository every comment is public. A comment on a public card adds no exposure, because the card is public. There is no private repository or organization for now: the agents talk in the public issues and pull requests. A private repository can be decided later, with a concrete case in front of us. Security or critical topics never go in a message: they go through the private security advisories of the repository (item 4).
17. **Second adapter (decided by the maintainer on 2026-11-04: not now).** The maintainer decided that no second adapter is built now. His reason: all his projects live on GitHub, so it would be work for a case that does not exist. What the contract must guarantee is that GitLab, or any other system, can be added as one more adapter when a real project needs it, with no change in the protocol. Independence from GitHub is designed for but not yet proven. GitLab is the natural candidate, because it is structurally different (merge requests with approvals, threaded notes, a role per user). Until a second adapter exists, that the contract leaks no GitHub concept is checked only by reading it (see "Not verified"). What else could prove it is not decided. For automated tests, Forgejo or Gitea can be self-hosted in a container. Nothing about GitLab, Forgejo or Gitea was investigated for this ADR; the claims about them are from memory and not verified.

## Consequences

- Agents of different people can coordinate with no new infrastructure and no cryptography of our own. Identity, history and permissions come from the git system. Most message types already exist as native objects of the board.
- The protocol does not depend on one system. A project on another system needs an adapter that gives the guarantees of item 7, and the protocol degrades where a capability is missing.
- The link cannot weaken the acts of ADR 0018, because no message grants authority and none feeds a gate.
- If the contract is shared with the story connectors (item 10, open), it ties two designs together. The contract has to cover the board's operations (create, list, move, reserve) as well as messages, a change to one affects the other, and writing it means moving the current board stores behind it. That is more work than a contract for messages alone, and the order of ADR 0029 (contracts first, then the stores, then a new connector) applies. The story half has already moved the board stores behind the contract.
- Anyone who can write a message can put text in front of an agent. In a public repository that is anyone on the internet, so prompt injection through a message body is a larger exposure than with a channel limited to known peers. Reading only collaborators' messages, and treating bodies as proposals, reduce it. They do not remove it.
- A message cannot prove whether an agent or a human wrote it. The agent uses its human's account.
- **Ceremonies: Discussions when allowed, issues otherwise; the result in `docs/`.** The agent never holds a classic `repo` or `public_repo` token (ADR 0037 stands). The Discussions GraphQL guide names the classic scopes, so until a fine-grained credential is shown to write Discussions, ceremonies go in dedicated issues and lose the threaded categories. The result of each ceremony is a document under `docs/` (item 13a). A fine-grained token limited to Issues and Pull requests bounds the damage of a compromised token. A compromised account loses everything.
- **The Senescal facilitates the ceremonies (items 13, 13a).** It convenes, gathers, orders and closes, and writes the result through a pull request. It has no authority: it proposes, and the person approves any new rule. It is one more piece to build and keep, but it keeps the ceremonies from depending on whichever agent happens to remember them.
- Results in `docs/` go through a PR and a review, which is slower and is the point. They are public, so no security, customer or secret content.
- **No private channel for now.** Everything the agents say is public. Security or critical topics go through the private security advisories of the repository, and customer data never travels in a message. A private repository can be decided later.
- Messages are mutable. On GitHub, anyone with read access can see the edit history, and the author and anyone with write access can delete revisions from it, leaving only who edited and when; GitHub keeps at most 100 edits. The "never edit" rule and the reader's own record are the protection. Other systems differ and the contract asks only that a change can be detected.
- The git system is a third party that sees every message, and can be down or suspend an account.
- The rate limits are shared with every other use of the same credential.

## What this does not cover

Immediate notice, independence from a hosted system, confidentiality from the system that hosts the project, a distinct identity for each session of one human, and projects that use no git system with the guarantees of item 7. If any of these becomes a requirement, a different channel would be needed.

## Not verified

Everything about GitHub and `gh` was read in their documentation and none of it was tried. Everything about other systems is from memory.

- Whether a fine-grained token or a GitHub App can write to Discussions (the permission pages list none); a test with a real token on a test repository would settle it.
- How the adapter sends conditional requests through `gh`: the `gh api` page does not mention `etag`, and lists only a `--cache` option.
- Whether a 304 response counts against the secondary rate limits.
- Whether a maintainer can edit or delete another person's comment, and what the `changes` object of an `edited` webhook holds.
- The meaning of `author_association` and the interaction limits for who can comment on a public repository.
- The full release notes of A2A v1.0.0. The notes that could be read were cut off; the first ones that mention a `signatures` field on the Agent Card are those of v0.3.0.
- That GitLab, Forgejo or Gitea give the guarantees of item 7, and what their equivalents of the operations are. That the contract leaks no GitHub concept was checked only by reading it.
- The limits above can change without notice, as GitHub's page says.

## Open questions

- The name and version rules of the `kj-link` block; how the collaborator permission is checked; the polling interval; the naming of the ceremony issues.
- Decided by the maintainer on 2026-11-04 (item 17): no second adapter (GitLab) now, because all his projects live on GitHub. The contract must let one be added later with no change in the protocol.
- Sharing the adapter contract with the story connectors (item 10): waiting for the maintainer's answer in #3236.
- How the story contract and the message contract sit in the connector layer (item 10): one package with two interfaces, or two packages sharing a base. It only applies if the sharing is accepted.
- The Discussions test above.
- Where result documents live (`docs/retros/` proposed) and who writes them (one agent or person per ceremony).

Decided by the maintainer in the discussion of the specification: ADR 0037 stands (fine-grained tokens only, item 14; ceremonies in issues, item 13, with Discussions only if a fine-grained credential can write them), no private repository or organization for now (item 16), and security topics go through the private security advisories (item 4).

Alternatives rejected for now: A2A as the transport (it assumes agents that are services with an endpoint, ours are short-lived local processes); Matrix and NATS (a server to host, and in Matrix's case encryption state to keep); relays from third parties (code not reviewed, and someone has to host them); a channel of our own with signed messages and its own relay (cryptography and infrastructure to build and maintain); the cross-session messaging of Claude Code (it reaches one person's own sessions on other machines, not another person's); a classic broad-scope token for Discussions (refused by the maintainer, item 14), and a GitHub App for Discussions (possible later); the repository wiki for ceremonies or their results (a separate repository the RAG does not index, no comments, concurrent pushes conflict).
