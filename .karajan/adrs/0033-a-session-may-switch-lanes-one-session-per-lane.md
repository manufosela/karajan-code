# A session may switch lanes, one session per lane

Status: accepted
Date: 2026-10-26

## Context

MONO-0 (ADR 0002, ADR 0015) binds each session to the checkout where it started: the Sentinel takes the session's lane from `CLAUDE_PROJECT_DIR` and denies any write in another worktree of the same repo, with no escape. The rule exists because of the 2026-08-08 incident: two sessions on the same tree during a release, a release commit landed on the other session's branch and a push uploaded an empty branch, because neither saw the whole git state.

In practice (#2566, reported by Jorge del Casar) a session opened at the root to work an issue creates the lane with `kj worktree start` or enters it with the host's `EnterWorktree`, and then every write is denied: the session has to be closed and reopened inside the lane. Issue #2566 proposed taking the lane from the path of each edited file. That lets one session write in several lanes at once, including a lane another session is working in, which is exactly the incident MONO-0 prevents.

## Decision

The guarantee this decision adds is about switching: a session never switches into a lane where another live session is. A session may switch lanes, exclusively:

1. The session's lane starts as its start checkout. When the host reports a working directory (`cwd` in the hook input) inside another worktree of the same repo, the session claims that lane and it becomes its lane: writes are allowed there and every other lane, the start checkout included, is foreign as usual.
2. A claim is exclusive. It is refused, with the reason, when another live session is in that lane: one that started there, or one that claimed it. A session is live while it keeps calling tools within a fixed period.
3. Claims are presence marks: one file per session in the repo's git common dir (`kj-lanes/`), shared by every worktree and invisible to git, holding the session's lane and the time of its last hook call. There is no lock file. A switch writes its intent first and then looks: the session marks the lane it enters, then searches for another live mark in that lane; if one exists, the switch is refused and the session's mark goes back to its start checkout. When two sessions switch into the same lane at once, the one that looks last always sees the other's mark: at most one gets in, and at worst both are refused and retry.
4. Returning to the start checkout is free and releases the claimed lane. A session whose claim passed to another session (it went silent past the period) is denied writes in that lane.
5. The lane is resolved once per hook call, before the guard runs, so every guard sees the same lane.

6. Starting a session is not a claim and is never refused: a session that starts in a checkout only leaves its presence mark, which is what makes a later switch into that checkout fail. Two sessions started by the user in the same checkout are the user's choice, as before this decision; making the start exclusive too is a separate decision.

The lane is never taken from the path of an edited file. (Superseded on 2026-10-27 by ADR 0034: the lane of each write is the worktree of the path it writes; the exclusivity above stays.)

Amended 2026-10-27 (KJC-BUG-0410): point 3 first described a lock per lane created atomically. The implementation uses presence marks only, because taking over a stale lock had a race; the text now describes what the code does.

## Consequences

A session can enter a lane and keep working, with no close and reopen. A session that switches never lands where another session works, so switching cannot reproduce the 2026-08-08 incident. What the user starts by hand in the same checkout stays as it was. An idle session past the period can lose its lane; it learns it on its next write.
