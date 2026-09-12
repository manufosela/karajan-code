---
title: The gates
description: Deterministic git gates make a false green structurally impossible.
---

Everything else in Karajan is advice to an AI. The gates are not: they run in git, they are deterministic, and no model — however clever — can talk its way past them. This is the core lesson v4 is built on: a real-world demo once produced a run marked "approved" with zero reviewer passes. The fix was not a better prompt; it was moving the guarantee into git.

## In practice — from your agent

You never touch any of this. Ask Claude Code, Codex, Antigravity or the VS Code assistant to build something. Before its commit can land, a **different** AI reviews the exact change, and you see the verdict right in the session:

```
✓ APPROVED by codex (diff 82a5504)
✗ REJECTED — the error path is untested
```

On a rejection your agent fixes it and reviews itself again; the commit only enters once a different AI signed off on **those exact bytes**. Open the [HU-Board](/docs/guides/hu-board/) and the same verdict is in the **Governance** view. You install nothing and type nothing — the guarantee just holds while you work.

## Under the hood — try it yourself

Want to see the mechanism? Every command runs on your machine, nothing leaves it:

```sh
kj review --install-gate      # commits the .karajan/review-gate marker; the team inherits it
# …stage a change…
kj review --staged            # a DIFFERENT AI reviews the exact diff and records the verdict
ls .karajan/reviews/          # one <sha256>.json per reviewed diff — the verdict store itself
kj review --check             # approved verdict for what's staged right now? (exit 0/1)
git commit -m "feat: …"       # the pre-commit hook runs --check for you; no verdict, no commit
```

Open a verdict to see what was decided, and against which exact bytes:

```sh
cat .karajan/reviews/<hash>.json   # { verdict, reviewer, diffHash, summary, confidence }
```

Every decision — each deny, each exception, the commit's own allow — is sealed in the hash-chained ledger, where editing the past breaks the chain:

```sh
kj policy report              # a readable report; a tampered chain exits 1
```

## The review gate (pre-commit)

With `.karajan/review-gate` present (installed by `kj review --install-gate`, tracked in git so the whole team inherits it):

1. Your agent stages a diff and runs `kj review --staged` → SonarQube scans the changed files first (deterministic pre-gate: BLOCKER/CRITICAL findings reject on the spot, without spending a reviewer token), then an AI **different from it** reviews and records a verdict in `.karajan/reviews/<sha256-of-the-diff>.json`, stamped with the workspace it ran from (`[root]` or `[worktree:<name>]`).
2. `git commit` fires the pre-commit hook → `kj review --check` verifies an **approved** verdict exists for the **exact** staged bytes.
3. No verdict, stale verdict, rejected verdict → the commit does not enter. Fix, re-review, retry.

Rejected but the agent disagrees? `kj solomon` brings a third AI to arbitrate; an approve ruling records a verdict that opens the gate — auditable, with the full conflict attached. Security findings are excluded: no arbitration, no override, ever.

## The other gates

- **Branch-first** — direct commits on the base branch are rejected (`KJ_ALLOW_BASE_COMMIT=1` is the explicit release-day escape hatch).
- **Board guarantee** — `kj env install` verifies an operational access path to the project's declared board (kj's HU Board, the Planning Game MCP, or an external board via MCP/API token) and blocks with the exact steps when there is none. There is no `none`: Karajan does not run without a board.
- **Commit policy** — Conventional Commits header, length cap, no AI attribution.
- **Chained personal guards** — if your machine had global git hooks before Karajan, the generated hooks call them too. Activating Karajan adds protections; it never silently removes yours.
- **Headless parity** — `kj run` (headless mode) stamps its internal reviewer's verdict the same way, so pipeline commits pass the same gate.

## Honest opt-outs

Every gate is visible and reversible — remove the marker file, unset `core.hooksPath`, or don't install the gate at all. Karajan's promise is not that you can't opt out; it's that **you can verify, in the repo, that nothing skipped review while it was on**. Trust becomes a `git log` question.
