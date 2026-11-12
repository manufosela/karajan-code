# The boards of a repository meet in a room and share their agents live over P2P

Status: accepted
Date: 2026-11-12 (accepted 2026-11-12)

## Context

ADR 0054 draws each teammate as a factory of their own, beside the own ones, and reads them through the agent link of ADR 0043: the cards from the shared board and an hourly status message. On 2026-11-12 the maintainer saw Jorge del Casar's factory with no robots and no movement. Both work in the same repository, karajan-code, so the maintainer asked for one factory per repository with the avatar of each person, and for the robots of every teammate to move as the own ones do, for teams of five people or more. An hourly status cannot move a robot, and ADR 0043 decides polling for coordination, not a live stream.

## Decision

Accepted by the maintainer on 2026-11-12.

1. One repository is one factory. The lanes and cards of every teammate who works in it are drawn inside it, each marked with its owner. This replaces point 1 of ADR 0054.
2. Each person picks an avatar from a list that ships with kj, and may tint the robot of each role. The choice lives in the own board and travels with the own activity, so every teammate sees it.
3. The boards that work on the same repository meet in a room named after the repository. Each board opens a WebRTC data channel to each of the others (a full mesh) and sends the activity of its agents through it: role, lane, card, model, effort and avatar, never free text, paths or secrets. The stage page keeps reading only its own board, which feeds the teammates' robots through the same path as the own ones. This replaces point 3 of ADR 0054 for the stage; ADR 0043 still governs coordination between agents.
4. A signaling service in the Firebase project of karajan-code admits a board to a room. The board proves who it is with its GitHub token; a function checks that the account has write permission on the repository, returns access to that room only and keeps no token. Realtime Database carries the offers, the answers and the presence of the room.
5. When a data channel cannot open (a strict NAT or a corporate network), that board sends its activity through the room in Realtime Database instead. There is no TURN server.
6. The hourly status of ADR 0054 point 5 stays, for the teammates who are not in the room.

Out of scope: rooms for private repositories of other owners, voice or screen sharing, and any control of a teammate's agents.

## Open questions

- How long a robot stays in the scene after its board leaves the room.
- Whether a person can stay out of the room while working on the repository.

## Consequences

The board gains a native dependency for WebRTC in Node and a client for Firebase. The mesh fits a team of up to 15 or 20 people with messages this small; a larger team needs a relay, which would be a later ADR. The activity leaves the machine, but only to the boards in the room and to the room's database, which only admitted members read. The work is split in atomic pull requests: one factory per repository, avatars and tints, the signaling function, the P2P channel and the fallback. Not verified: nothing here has been run between two machines yet.
