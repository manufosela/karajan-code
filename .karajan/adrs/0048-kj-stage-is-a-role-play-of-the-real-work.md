# kj stage is a role-play of the real work: one workshop per lane and every robot moves only on a real event

Status: accepted
Date: 2026-11-05 (accepted 2026-11-05)

## Context

On 2026-11-05 the maintainer watched the factory of ADR 0047 live and found two faults. It showed almost nothing of the real work: each worktree lane writes its own trace under its .karajan/harness and the stage only watches the main checkout, and only the agents kj launches (review, solomon, code) leave a trace, so the host agent and the subagents it opens never appear. And it lied by its shape: the ambient walks were decorative, and the conveyor drew Karajan as a sequence of stations, when the Sentinel watches every tool call from above and steps in only when it must, the reviewer comes when a diff is put before it, and the gates stand at the door of the commit. The maintainer asked for a real reflection of each role, kept the film (landing) as the place for decoration, and asked for the host agent at work whatever it does, its subagents as dwarf robots, an avatar with a mark on the chest, one smaller scale so the lanes fit, and zoom in and out.

## Decision

Decided and accepted by the maintainer on 2026-11-05. It replaces the ambient motion and the conveyor of ADR 0047; its 3D hall seen from above at three quarters stands.

1. Nothing moves without a real event. A robot with nothing real to do stands still at its post; no ambient walks, no speech bubbles that did not happen. A role with no trace yet (TDD, Sonar, and any other) is not drawn acting until it leaves one.
2. One workshop per lane, no conveyor: the main checkout and every worktree under .kj/worktrees and .claude/worktrees is a bench area with its name on the floor. The stage discovers lanes when it starts and when one appears or goes.
3. Each role acts as it does in Karajan. The Sentinel stands on a raised post over the whole hall and turns to the lane whose tool call it checks; on a denial it goes down to that agent and stops it. The reviewer walks to the lane when a diff is put before it and gives its verdict there; Solomon walks in only to arbitrate. kaRAGan walks to the agent with the answer when it queries the RAG. The Ledger seals at its desk when a decision is recorded. The git gates stand at the door of each workshop and a commit passes them or bounces.
4. The host agent (claude, codex, whoever opened the session) is a robot at its lane bench while it works: the hooks kj harden installs append to the lane trace when it starts, a throttled heartbeat with the kind of tool it uses, and when it stops. Each subagent it opens walks out of it as a dwarf robot and walks back when it ends.
5. The host robot wears a badge on its chest with the host name and colour; the npm package never ships a third-party logo (trademark).
6. Everything shares one smaller scale so several workshops fit, and the camera zooms in and out with the wheel and with pinch, within limits.

## Consequences

The ambient loop and the conveyor are removed. The Sentinel check of every tool call and the RAG queries need a trace they do not leave today, throttled so the files stay small and are tailed, never read whole. The hook templates change, so the maintainer seals them again with kj harden. The work is split in atomic PRs: lanes feed, workshops and zoom, host trace, roles that act (one PR per role), subagents, avatar.
