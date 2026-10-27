# The Sentinel takes the lane from the path it writes

Status: accepted
Date: 2026-10-27
Accepted: 2026-10-27 (dev_001)

## Context

MONO-0 (ADR 0002, ADR 0015) ties each session to one lane, and ADR 0033 lets a session switch lanes, one session per lane. Field use (#2566, Jorge del Casar) shows that is still not enough for autonomy: to work several user stories in parallel the person opens one Claude session per lane (`claude -n HUxxx`) and drives each by hand, because a session cannot write in a lane other than the one it is in. Module 8 of the #2566 plan (sentinel-path-lane) proposed taking the lane from the path of each write instead, so one session can work every lane. ADR 0033 had ruled that out ("the lane is never taken from the path of an edited file") because one session writing in several lanes could land where another session works, which is the 2026-08-08 incident MONO-0 prevents.

## Decision

The lane of each write is the worktree that contains the path it writes, not the session's start checkout.

1. For Edit and Write, the lane is the worktree that contains `file_path`. For Bash, it is the worktree of the directory the command runs in (`cwd` in the hook input, or the `git -C` / `--prefix` target). A path outside every worktree of the repo is foreign, as before.
2. The exclusivity of ADR 0033 stays: a write is refused, with the reason, when another live session holds that lane (it started there or claimed it). The presence marks of ADR 0033 (`kj-lanes/` in the git common dir) are the source; writing in a lane renews the session's mark for it.
3. One session may hold several lanes at once, one mark per lane. A lane it stopped writing in is released after the same idle period as ADR 0033.
4. The guards that judge a write (card first, branch first, harness paths) judge it against the lane it lands in: its branch, its card, its harness.

## Alternatives considered

- **Keep ADR 0033 as is (switch lanes, one at a time).** Safe, but a session works one story at a time, and parallel work still needs one session per lane driven by hand.
- **Greenfield: one orchestrating session that spawns a subagent per lane, each bound to its lane.** Keeps one lane per worker, but it ties parallel work to hosts with subagents, and the Sentinel would need to tell each subagent's calls apart to bind each one to its lane.
- **Lane from the path, without exclusivity.** Simplest, but reopens the 2026-08-08 incident: two sessions writing in the same lane. Rejected.

## Consequences

One session can carry several stories in parallel, each in its lane, without reopening. Two sessions still never write in the same lane. Every guard must resolve the lane per write instead of once per session, so the lane resolution moves into the guards' shared input. ADR 0033's last line is superseded by this decision.
