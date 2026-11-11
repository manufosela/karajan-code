# The landing's factory page replays a real task with the kj stage scene copied at deploy

Status: accepted
Date: 2026-11-11 (accepted 2026-11-11)

## Context

The user asked on 2026-11-11 to show the Factory (kj stage, ADR 0046 to 0050) on karajancode.com (epic KJL-PCS-0008). The landing is static: there is no board, no /api/stage/state and no /api/events. The scene lives in packages/hu-board/public/stage (about 6,500 lines without the cast); a copy in git breaks the 200-line PR budget and has to be redone on every scene change. ADR 0048 asks for real reflection, never decoration.

## Decision

Accepted by the maintainer on 2026-11-11. (1) The demo is real karajan-code work: HU-3870 of the kj-stage lane (2026-11-11), rebuilt from the files kj already writes in .karajan (traces, reviews, policy decisions) and sanitized with kj privacy scan. (2) The landing predeploy copies packages/hu-board/public/stage to public/factory/stage-<content hash>/, ignored by git, with the style block of stage.html as stage.css (the labels the scene draws are styled there), and writes public/factory/stage.json naming that folder; the hash keeps Firebase's immutable cache honest. (3) /factory (EN and ES) imports the scene from that folder; 'three' resolves to the landing bundle, the same one the board checks by ADR 0046. (4) The board's stage/main.js is the board's own starter (token, project in the URL, map), so the landing has its own: it builds the hall with the scene's factory.js and drives its live.js with the trace in place of /api/stage/state and /api/events. It plays the events in their real order, cutting the idle gaps to 2-3 seconds, with a clock showing the real time of each moment, and can pause and start again. (5) The home gets a short block with a still or clip of the same scene and a link to /factory.

## Consequences

One source for the scene: every deploy carries the scene of the main it is made from, with no parity test to keep. The board is not changed. A change to what factory.js or live.js take breaks the landing's starter, so a landing test checks the starter against the scene it copies. The page needs the copy step to work locally (the same script the predeploy runs). Alternatives rejected: a checked copy in git (a 6,500-line large-pr-justified PR, recopied on every change), a video (not interactive, re-recorded on each change) and a kj stage --export command (one source, but it changes the board the kj-stage lane is working on).
