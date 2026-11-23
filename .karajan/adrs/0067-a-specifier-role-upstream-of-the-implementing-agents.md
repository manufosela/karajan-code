# A Specifier role upstream of the implementing agents

Status: proposed
Date: 2026-11-23

## Context

Several agents implement cards in parallel across repos. They stop often, and for causes that repeat. Each cause is a class, not a case:

1. A design decision nobody took surfaces halfway through the implementation.
2. A file or act reserved to a person (a sealed file, a human act) forces a review or a re-seal and blocks the flow.
3. A card depends on another card's merge, so its agent waits.
4. A card is too big and is split while it is being worked.
5. A requirement cannot be proven with the means at hand, and that is found late.
6. Infrastructure, secrets or permissions do not exist when the code is ready.
7. An internal tool is broken and no alternative was agreed.

Today every one of them is found by the implementer, in the middle of the work, and costs an idle agent. What kj already covers, verified in the code:

- Dependencies: cards carry `blocked_by`; `src/hu/graph.js` orders them and refuses a cycle. Nothing says "ready".
- Card states: `pending, running, done, failed, skipped` (`kj hu move`). No state between "written" and "may be implemented".
- Size: the `shrink-budget` CI gate (200 net lines) and `kj pr-size` catch a big diff after it is written, not the card before.
- Tiers: `kj hu tier` records how deep a card is, not whether it is ready.
- Human waits: `src/harden/handoff.js` and `src/harden/human-act.js` register an act only a person can do, after a gate denied the agent. It is reactive: it exists once the agent is already blocked.
- Reserved files: the seal (`src/harden/supervisor-commit.js`) covers hooks, governance files, workflows and host settings; the plan to seal what a plugin brings is still open (#4446).
- Review: `kj review --staged` gives a cross-AI verdict of a diff (`src/commands/review-gate.js`), never of a spec.
- Roles: `templates/planner.md`, `templates/hu-reviewer.md`, `templates/discover.md` and `kj brief planner|triage` describe planning and gap detection, but they are briefs for whoever coordinates, run when that agent chooses, with no output contract and no gate on the queue.

## Decision

Add a role, the Specifier, separate from whoever coordinates and from whoever implements.

- Input: an objective or an epic.
- Output, per block of work: (a) a spec reviewed in fresh context by a reviewer other than its author; (b) cards of at most 200 net lines, each with acceptance criteria that can be checked and the test that proves them; (c) the dependency graph and the order; (d) a decision pack: each open decision with options, a recommendation and a reversible default; (e) the prerequisites and the person-only files or acts, grouped into single steps for the person.
- The Specifier does not implement, does not merge and does not decide what belongs to the person.
- Definition of ready. A card enters the implementation queue only with: checkable criteria; the test defined; feasibility confirmed (a short spike when needed); no open decision, or its default accepted; dependencies resolved or chained; prerequisites available; at most 200 net lines.
- Return path. An implementer that finds a hole in the spec returns the card to the Specifier with what is missing, instead of stopping.
- Metrics: hours of ready queue per agent (how long an agent had a ready card waiting, or none), and returns per spec hole.

### How it is modelled in kj (second step, after the pilot)

- A card state `ready`, between `pending` and `running`; a card also gets a `returned` mark with the hole it names.
- A definition-of-ready gate, run by `kj hu move <id> ready`, which checks each condition above from the card's fields and refuses with the missing one. Same style as the other gates: it names what is missing.
- A queue command, `kj hu queue`, listing what is ready, what waits on a card, and what waits on a person (read from the decision pack and the handoffs).
- The decision pack lives in the card (or a parent comment for a block) as a fixed section: decision, options, recommendation, default, who decides. The person's answer is recorded on the same card, so a default can be reverted by its id.
- `kj hu start` keeps working as today; a card that is not `ready` warns first, and refuses once the gate is on.

### Optional design review with context-free reviewers

The spec review can use fresh-context reviewers. One candidate is the open-source Elephant-Goldfish Model plugin (https://github.com/google/elephant-goldfish-model, Apache-2.0): one agent keeps the design context and several reviewers with none read the spec cold. Fit: it would run inside the Specifier session at step (a), not in the CI path. Cost: one subagent per reviewer per spec, so a block with N specs costs N times the reviewers; the pilot caps it at two per spec. Supply-chain risk: a plugin brings hooks and MCP servers that run in the agent session. Pin an exact version, review the diff by a person on every update, and do not enable it in a repo until the plugin seal exists (#4446), since today nothing seals or lists what a plugin brings. Without that, the Specifier uses the cross-AI reviewer kj already has.

## Alternatives considered

- The coordinator specifies. Rejected: it is the same agent that dispatches and merges, so specifying competes with unblocking; the author of the spec would also be its reviewer.
- Each implementer specifies its own card. Rejected: the holes are found mid-work, which is the problem; decisions and person-only steps are not batched, so the person is interrupted once per card; and the author checks his own spec.
- Do nothing and keep reacting (handoffs, splits at the PR). Costs an idle agent per hit, with no way to measure it.
- As if the codebase did not exist: one planner that owns the whole queue and schedules agents by readiness, humans included. It is the end state; the Specifier role and the `ready` state are its first two parts, and it is why the queue command exists.

## Compatibility with one PR per card

Unchanged. The 200-line limit moves up from the CI gate to the definition of ready, so a card that is too big never reaches an implementer. A split found later is a return to the Specifier, which produces the new cards before any code is written. One card, one lane, one PR.

## Pilot plan

1. No change in kj: one session with a fixed prompt acts as the Specifier on real blocks of work, writes the spec as the issue body, the plan as a parent comment and the decision pack as a comment; the existing cards and `blocked_by` carry the graph. Count the two metrics by hand.
2. If hours of ready queue go up and returns stay low over a set of blocks, build the `ready` state, the gate and `kj hu queue`, one card each.
3. Design review with context-free reviewers only after step 1 shows the spec review is worth its cost, and only once #4446 is done.

## Consequences

Implementers stop less, and the person gets decisions and reserved steps in one batch. The price is a new role to run, a spec review per block, and a delay before the first card is ready; for small cards the gate would be pure ceremony, so tier `trivial` skips it. The Specifier can also be wrong, which the return path and the returns metric make visible.

## Risks and open questions (for the person)

- Who decides when a default is accepted on the person's behalf: the person per block, or a standing rule for decisions marked reversible?
- Is `ready` a state of the board backends (GitHub, Linear) or a kj-side mark? The GitHub backend today has no state between pending and running.
- Does `trivial` skip the gate, or only skip the spec review?
- A spike that proves feasibility writes code; where does it live so it is not merged?
- Reviewer cost and who pays it per block, and whether the Elephant-Goldfish plugin is worth it at all before #4446.
- The ADR does not say where the Specifier runs: a Claude session with a prompt (pilot) or a kj role with its own panel slot (later).
