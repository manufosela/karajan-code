# kj stage draws the factories of the teammates from the agent link

Status: accepted
Date: 2026-11-11 (accepted 2026-11-11)

## Context

ADR 0049 limits the map of kj stage to the projects of this user on this machine, and its point 5 leaves the factories of other people to a later ADR. ADR 0050 draws the cards from the trace of the lane where kj hu add or kj hu move ran, so a card moved on another machine leaves no trace here and the map shows only a sample of the shared board. ADR 0043 (proposed, with its main points decided by the maintainer) defines how the agents of different people coordinate: the status message, readAssignee, listSince, polling and not push, a public repository and its privacy rules. Its pieces are built: the message contract, the codec, the GitHub adapter read and write sides, the rules of use and the kj link command (HU-3792 and HU-3796 to HU-3804). No ADR decides what the stage draws of another person or where it reads it from. Raised by Jorge del Casar in issue 3854; on 2026-11-11 the maintainer asked to see the agents of the teammates who work in the same repository.

## Decision

Accepted by the maintainer on 2026-11-11.

1. The map shows one factory per teammate with work in the project, next to the own ones.
2. The only source for what is not on this machine is the agent link of ADR 0043: the cards and their holder from the shared board through the adapter, and the activity from the status messages. The stage never reads files of another machine.
3. It draws the last known state, not live animation, because ADR 0043 decides polling. Each remote factory shows the age of its last message and goes dim after a while.
4. What is published obeys the privacy rules of ADR 0043: public repository, no home paths, no secrets, kj privacy scan before it goes.

Out of scope: the ceremonies of the Senescal (a later ADR) and any live event stream between machines.

## Open questions

- How long until a remote factory goes dim.
- Whether a person can hide their factory from the team map.
- Where the Senescal ceremonies appear on the map.

## Consequences

It builds on ADR 0043, which is still proposed: if 0043 changes the status message, this ADR follows it. The work is split in atomic pull requests of about 150 lines: read the shared board for the cards of the team, draw a remote factory, show its age and dim it, publish the own status. Not verified: nothing here has been run against a second machine; the status message as kj link sends it was read in code, not tried between two people.
