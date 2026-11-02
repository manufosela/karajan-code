# kj delivers the card skills to the developing agent and the reviewer enforces them

Status: proposed
Date: 2026-11-02

## Context

Since 5.0 the host agent develops and no skill reaches it: the v4 pipeline injected skills into the coder prompt, the host gets nothing, and in a project with an atril store even the reviewer misses the local catalog. Debated with the maintainer on 2026-11-02: a gate that only checks the agent ran a query proves nothing, and whole skills waste tokens.

## Decision

Before the first code edit of a card, kj (not the agent) asks atril which skills fit the card, with the card title and acceptance criteria as the task, and takes at most 2 above a fit threshold; the Sentinel denies that edit once with their short rules (description, Red Flags, Verification) and records what it delivered for the card; kj review hands the same rules to the reviewer, which rejects a diff that does not follow them. Nothing is delivered when no skill fits.

The split with atril: atril owns the catalogs, choosing the skills for a task (`atril route`) and the skills' content, including their short form; kj owns making it mandatory (the delivery gate, the record per card and the enforcement in the review). kj builds no resolver of its own and adds nothing to the legacy `src/skills` path that ADR 0021 retires.

## Consequences

One extra denied edit per card and a short context block; the fit threshold must be calibrated with real tasks; the gate cannot prove reading, the review proves compliance. It depends on atril: the catalogs declared in HU-3198 must answer `atril route`, and the short form of a skill is agreed with atril's maintainer before kj consumes it.
