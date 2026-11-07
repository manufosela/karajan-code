# kj stage is a map of every factory of the user, with zoom from the whole map down to one workshop

Status: accepted
Date: 2026-11-06 (accepted 2026-11-06)

## Context

ADR 0048 made the stage a real reflection of one project: one workshop per lane, the host robot and its dwarf subagents. On 2026-11-06 the maintainer had about ten Karajan sessions working at once in several projects and could only see one project at a time, choosing it in the board. The maintainer asked for a big map with zoom where every factory is seen working at once. The board already serves every project (ADR 0011: it knows each one by the projectDir its plans recorded) and already watches the lanes of one project per stream. This is the first piece of the multi-factory vision of 2026-11-05, kept to the projects of this user on this machine.

## Decision

Decided and accepted by the maintainer on 2026-11-06.

1. One map, one factory per project: every project the board knows is a factory on the map, each one built as ADR 0048 says (its workshops per lane, its own Sentinel, its own gates). Factories with work in the last hour go first and lit; the rest stand dim after them.
2. Zoom goes from the whole map down to one workshop: far away each factory shows its name and how many robots are at work; closer, the detail of ADR 0048 appears. Clicking a factory flies the camera to it. The stage of one project (`/stage.html?project=<slug>`) stays as it is.
3. One stream for the whole map: the server watches the lanes of every project and sends each event tagged with its project and lane. The browser opens one connection, not one per project (a browser allows about six per host).
4. Nothing moves without a real event, as in ADR 0048. A factory whose project lacks the latest kj harden shows what its hooks trace and nothing more.
5. Only this user's projects on this machine. The factories of other people, how they talk to each other and the ceremonies of the Senescal are a later ADR.

## Consequences

The server watches more directories (about ten projects with their lanes), throttled as today; a project that leaves the plans leaves the map. The scene draws far less detail when far away so ten factories stay smooth. The work is split in atomic PRs: the list of projects and the single stream, factories placed on the map, zoom levels and the flight to a factory, the entry in the board's navigation.
