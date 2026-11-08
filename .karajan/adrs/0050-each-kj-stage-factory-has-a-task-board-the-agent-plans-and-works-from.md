# Each kj stage factory has a task board that the agent plans on and takes its work from

Status: accepted
Date: 2026-11-07 (accepted 2026-11-07)

## Context

ADR 0048 shows the work once it has started: the host robot at its bench, its subagents, the review and the gates. On 2026-11-07 the maintainer asked how the start of a task is seen. In Karajan a task starts on the board: the agent plans, creates the cards (kj hu add), refines and splits them, and only then takes one (or several, one per worktree) and works it until it is done. None of that is on the stage today. The HU Board holds the cards; an external board (Planning Game, Linear, Jira) may hold a replica, which the maintainer does not want drawn. The cards of a shared board live as GitHub issues, so the stage cannot read them from local files the way it reads the rest.

## Decision

Decided and accepted by the maintainer on 2026-11-07.

1. Each factory has a task board, a wall with three columns (to do, in progress, done) beside the posts of Karajan's pieces. Its cards are the HU Board's cards of that project; the external board is never drawn.
2. Planning is seen: when the agent creates a card, the host robot walks to the board and pins it in to do; a card refined or split changes there, with its id and a short title.
3. Taking a task is seen: when a card moves to in progress, the robot of the lane that took it carries it from the board to its workshop, and the card stays over its bench while the work lasts. Several worktrees, several cards, one per workshop.
4. Finishing is seen: when a card moves to done, the robot carries it back to the done column.
5. Nothing moves without a real event, as in ADR 0048: kj hu add and kj hu move (and the MCP tool that does the same) append a line to the trace of the lane where they run, whatever backend holds the cards. On open the board shows the last state of the cards, read from that trace.
6. On the map of ADR 0049, far away a factory shows how many cards it has in progress; the cards themselves appear as the camera comes closer.

## Consequences

kj hu add and kj hu move write one more trace line, small and throttled like the rest. A card created from the HU Board's web or straight in GitHub leaves no trace and is not drawn until kj moves it. The work is split in atomic PRs: the trace of the cards, the board in the factory with its last state, the robot that pins and carries the cards, and the count on the map.
