---
title: The Sentinel, gate by gate
description: Every message the Karajan Sentinel prints, what it protects, and what each KJ_ALLOW_* escape means.
---

The Sentinel is the set of synchronous hooks `kj harden` installs in your agent's harness. Every message it prints starts with `karajan sentinel:` and ends with a link to its section on this page. The host harness may wrap it in its own words (Claude Code says "stop says", "PreToolUse hook error") — the body is Karajan's.

Two rules apply to everything below. First: the Sentinel blocks *before* the action runs — nothing is undone, because nothing happened. Second: every escape is an environment variable you prefix to ONE simple command (`KJ_ALLOW_X=1 git …`); it is ignored on command chains (`;`, `|`, `&`, `$( )`, backticks — `2>&1` counts), and every use is recorded in the session state and sealed into the decision log. An escape is a conscious, auditable exception — never a setting.

## card-first

Work needs a tracked card before it starts. Editing sources on the base branch, or on a branch whose name references no card, is blocked. Create the card (`kj hu add`), move it to running, and work on a `feat/<CARD-ID>-description` branch. Escape: `KJ_ALLOW_NO_CARD=1`.

## cross-lane

Since MONO-0, each session mutates only its own worktree lane; reading is free. The guard also refuses mutations it cannot verify: `cd` in a mutator chain, command substitution, shell expansion, or redirections whose target hides behind a variable — use `git -C`, `npm --prefix` and literal paths. Deliberate crossing: `KJ_ALLOW_CROSS_LANE=1` on a simple command.

## identity

The identity lock (ADR 0005): `gh`, `git push` and commit-authoring commands must run under the account this clone declares (`kj identity set`). Born from a real incident — one unswitched `gh` call posted as a client account on a public repo. Escape: `KJ_ALLOW_IDENTITY=1`.

## board-sync

A merged card must be moved in the tracker before anything else advances — commit, push, new PR, another merge, or ending the turn. Clear it with the real tracker call (`update_card` via MCP, or `kj hu move`). Escape: `KJ_ALLOW_BOARD=1`.

## policy

`.karajan/policy.yml` is evaluated on every tool call. A deny names its rule and reason. Security-tagged rules have NO escape and NO arbitration. For the rest: `KJ_ALLOW_POLICY=1` (the commit will also require `KJ_POLICY_REASON`).

## steward

The Steward's sweep can declare the project state bad enough that starting new work is blocked (security invariants, persistently red main — only where the project opted in). Remedy what the report names, or escape for this session: `KJ_ALLOW_STEWARD=1`.

## claims

A hard datum in a PR body or final message that is DENIED by this turn's own outputs is a proven hallucination — the PR is refused before it exists. Verify the datum or mark it unverified. Detail: `kj claims check`.

## release

`kj release check` must be green before anything publishes or deploys. The one legitimate chicken-and-egg: the landing shows the new version only *after* the publish — that step runs under `KJ_ALLOW_RELEASE=1`, recorded like every other escape.

## supervisor

The Sentinel's own files (`.karajan/harness`, hooks) are read-only from inside a session — a supervisor a session can edit is no supervisor. Only the human dismantles or regenerates it (`kj harden`), outside the session. Tampering is detected against what the installed kj itself would write.

## stop-gate

The turn cannot end while the method is red: suite failing, unreviewed diffs, pending board moves, unbacked claims. Resolve the listed violations or ask your user for the applicable escape. State: `kj sentinel status`.

## push-gate

Same as the stop gate, at the moment of `git push`: nothing leaves the machine with the method red.

## escapes

Every escape, what it skips, and when it is legitimate. All of them: one simple command, one use, recorded in the session state and sealed into the decision log — `kj sentinel status` lists what this session used.

| Escape | Skips | Legitimate when |
| --- | --- | --- |
| `KJ_ALLOW_NO_CARD=1` | card-first | Emergency fix agreed with your user before the card exists |
| `KJ_ALLOW_CROSS_LANE=1` | cross-lane / unverifiable-path guards | A deliberate, announced crossing (e.g. publishing from a tag worktree) |
| `KJ_ALLOW_IDENTITY=1` | identity lock | Test suites exercising other gates; never for real pushes |
| `KJ_ALLOW_BOARD=1` | board-sync | The tracker itself is down and the move is queued |
| `KJ_ALLOW_POLICY=1` | non-security policy denies | The rule mis-fires and the fix is agreed; commit also needs `KJ_POLICY_REASON` |
| `KJ_ALLOW_STEWARD=1` | steward hard block | The break is known, carded, and the user says work continues |
| `KJ_ALLOW_RELEASE=1` | release check | The publish→landing ordering above |
| `KJ_ALLOW_NO_TESTS=1` | tests-with-code gate (staged code with no test changes) | The diff genuinely owes no test and it is agreed |
| `KJ_ALLOW_PII=1` | privacy denylist block at commit time | A confirmed false positive, reviewed by the human |
| `KJ_ALLOW_REWRITE=1` | the guard against reserializing whole JSON files from Bash | A full-file rewrite IS the agreed change |
| `KJ_ALLOW_WRITE=1` | the Write-over-existing-file block (use Edit) | A full regeneration is exactly what was asked |

There is no `KJ_ALLOW_*` for security findings. That is the point.
