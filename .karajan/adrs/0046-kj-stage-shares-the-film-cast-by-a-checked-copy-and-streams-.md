# kj stage shares the film cast by a checked copy and streams events from the files kj already writes

Status: accepted
Date: 2026-11-02 (accepted 2026-11-02)

## Context

kj stage (KJC-PRP-0030, issue #3233, epic KJC-PCS-0107) is a local 3D stage that shows live what Karajan does in a project. It reuses the cast of the landing film (apps/landing/public/film). The HU Board ships inside the kj package and the landing does not. None of the Sentinel denials, review verdicts or Ledger seals reach the board stream (/api/events) today, although all three are already written to files in .karajan/.

## Decision

Accepted by the maintainer on 2026-11-02. (1) The board keeps a copy of the film builders (robot, robot-head, parts, piece, pieces, stand, props, stage, stage-fx) under packages/hu-board/public/stage; a test fails when a copied file differs from its landing original. The film script (score, timeline, camera, cast, main, framing) is not copied: the stage has its own event-driven director. (2) three.js is the same trimmed landing bundle, copied and checked the same way. (3) The board watches the files kj already writes (Sentinel denials, review verdicts, the hash-chained decision log) and publishes typed events on /api/events; the Sentinel and kj review are not changed. (4) On open each piece shows its last real state, then the stage goes live; nothing is simulated. (5) kj stage starts the board when it is not running and opens /stage.html; the board project bar links to it.

## Consequences

apps/landing stays untouched and owned by its own lane; a change to the film cast must be copied to the board or the parity test fails. The kj package grows by about 150 KB compressed. Events reach the stage with the watcher delay, and survive a board that starts later. The atril skill load, the active agent and the commit-msg gate leave no trace today; giving them one is a separate decision when task 6 starts. Everything stays on the machine.
