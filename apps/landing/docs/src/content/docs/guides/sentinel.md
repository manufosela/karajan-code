---
title: The Sentinel, gate by gate
description: Every message the Karajan Sentinel prints, what it protects, and what each KJ_ALLOW_* escape means.
---

The Sentinel is the set of synchronous hooks `kj harden` installs in your agent's harness. Every message it prints starts with `karajan sentinel:` and ends with a link to its section on this page. The host harness may wrap it in its own words (Claude Code says "stop says", "PreToolUse hook error") — the body is Karajan's.

Two rules apply to everything below. First: the Sentinel blocks *before* the action runs — nothing is undone, because nothing happened. Second: every escape is an environment variable you prefix to ONE simple command (`KJ_ALLOW_X=1 git …`); it is ignored on command chains (`;`, `|`, `&`, `$( )`, backticks — `2>&1` counts), and every use is recorded in the session state and sealed into the decision log. An escape is a conscious, auditable exception — never a setting.

## In practice — from your agent

You don't run the Sentinel; it watches your agent's session. When Claude Code (or Codex, Antigravity, the VS Code assistant) is about to do something the project forbids — commit straight to `main`, edit a supervisor file, run a mutating command that can't be checked — the action is stopped *in the moment*, and the reason appears in the session with a link to the exact rule below:

```
karajan sentinel: card-first — work needs a tracked card before it starts …
  — doc: https://karajancode.com/docs/guides/sentinel/#card-first
```

Your agent reads that, does the sanctioned thing instead (branch first, ask you, use `kj worktree`), and moves on. You didn't configure anything — `kj harden` put the watchman there once, and it explains itself every time it acts.

## Under the hood — try it yourself

The Sentinel is a set of synchronous git/harness hooks. See where they live, and watch one fire:

```sh
cat .karajan/hooks/pre-commit          # the generated guards (do not hand-edit — kj harden owns them)
git commit -m "wip" -- .               # on main, or without a card → blocked, with the rule link
```

Every block, and every `KJ_ALLOW_*` escape you consciously use, is sealed into the decision log — so "what did the Sentinel stop, and did anyone override it?" is a `kj policy report` away.

## card-first

Work needs a tracked card before it starts. Editing sources on the base branch, or on a branch whose name references no card, is blocked. Create the card (`kj hu add`), move it to running, and work on a `feat/<CARD-ID>-description` branch. Escape: `KJ_ALLOW_NO_CARD=1`.

## rag-first

The RAG must have answered about a zone before the session touches it (ADR 0010). Every `kj_rag_query` / `kj rag query` of the session leaves a ledger of the sources it returned; editing a source none of them returned (nor a sibling in its directory) is blocked with the query to run. A new file only needs the session to have consulted at all. Docs, config and tests stay out, like card-first. Escape: `KJ_ALLOW_NO_RAG=1`.

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

`kj release check` must be green before anything publishes or deploys, and the guard recognizes the verb wherever the flags sit (`firebase --project p deploy --only hosting` is a deploy).

A red check never blocks the command that **repairs** it. The chicken-and-egg used to be the landing: the check wanted the site deployed with the new version, the guard blocked the deploy, and the only way out was switching the whole gate off. Now the item declares its own remedy:

```yaml
release_check:
  items:
    - name: the deployed landing shows the version as current
      command: curl -sf https://example.com/docs/ | grep -q 'v{version}'
      remedied_by: firebase deploy
```

The lifted check stays red in the report, because the fact has not changed; it just stops blocking its own fix, and the gate says which item it lifted rather than doing it in silence. Any other red check still blocks. A package publication is never excused: `npm publish` and `gh release create` are irreversible, so no declared remedy covers them, and `KJ_ALLOW_RELEASE=1` remains the one conscious escape.

## commit-gate

The review runs in the commit hook, so a flag that skips the hook skips the verdict, the policy and the privacy scan with it. `git commit --no-verify` is denied, and so is any abbreviation git would accept (`--no-ver`, `-n`, a short-flag cluster carrying it). Naming `core.hooksPath` is denied too, in any of git's doors to it (`-c`, `config`, `--config-env`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_PARAMETERS`), because moving that key switches off every hook at once. Even reading it: exempting reads invited slipping one in behind the change, and reading it again costs you one escape while losing the gate costs the verdict.

If the hook is broken, fixing it is the answer. If the commit really has to go in without it, that is your user's call: `KJ_ALLOW_NO_VERIFY=1`, recorded in the decision log like every other escape. The `--no-verify` that `kj harden --commit` uses internally is not affected, because it never goes through a tool call.

## supervisor

The Sentinel's own files (`.karajan/harness`, hooks) are read-only from inside a session — a supervisor a session can edit is no supervisor. Only the human dismantles or regenerates it (`kj harden`), outside the session. Tampering is detected against what the installed kj itself would write.

## stop-gate

The turn cannot end while the method is red: suite failing, unreviewed diffs, pending board moves, unbacked claims. Resolve the listed violations or ask your user for the applicable escape. State: `kj sentinel status`.

## push-gate

Same as the stop gate, at the moment of `git push`: nothing leaves the machine with the method red.

## attribution

AI attribution is forbidden by a deterministic project rule — everywhere, with no escape. Three layers enforce it: the commit-msg hook rejects it in commit messages; the pre-commit hook scans the staged diff's ADDED lines (changelog, docs, code comments — tool *mentions* stay legal, attribution does not); and the Sentinel scans every `gh` command that publishes text (PR/issue/release create, edit, comment, review), including the contents of `--body-file`/`--notes-file` — an unreadable file does not publish either. CI re-checks commits, PR body and title. Born from a real catch: 15 PR bodies shipped an attribution footer because only commit messages were scanned (KJC-BUG-0164).

## escapes

Every escape, what it skips, and when it is legitimate. All of them: one simple command, one use, recorded in the session state and sealed into the decision log — `kj sentinel status` lists what this session used.

| Escape | Skips | Legitimate when |
| --- | --- | --- |
| `KJ_ALLOW_NO_CARD=1` | card-first | Emergency fix agreed with your user before the card exists |
| `KJ_ALLOW_CROSS_LANE=1` | cross-lane / unverifiable-path guards | A deliberate, announced crossing (e.g. publishing from a tag worktree) |
| `KJ_ALLOW_IDENTITY=1` | identity lock | Test suites exercising other gates; never for real pushes |
| `KJ_ALLOW_BOARD=1` | board-sync | The tracker itself is down and the move is queued |
| `KJ_ALLOW_NO_RAG=1` | rag-first | The RAG index is absent or broken on this machine and the fix is agreed; recorded once per session |
| `KJ_ALLOW_POLICY=1` | non-security policy denies | The rule mis-fires and the fix is agreed; commit also needs `KJ_POLICY_REASON` |
| `KJ_ALLOW_STEWARD=1` | steward hard block | The break is known, carded, and the user says work continues |
| `KJ_ALLOW_RELEASE=1` | release check | A red item nobody can repair right now, agreed with the human (the landing case is covered by `remedied_by`) |
| `KJ_ALLOW_NO_TESTS=1` | tests-with-code gate (staged code with no test changes) | The diff genuinely owes no test and it is agreed |
| `KJ_ALLOW_PII=1` | privacy denylist block at commit time | A confirmed false positive, reviewed by the human |
| `KJ_ALLOW_REWRITE=1` | the guard against reserializing whole JSON files from Bash | A full-file rewrite IS the agreed change |
| `KJ_ALLOW_NO_VERIFY=1` | the deny on `git commit --no-verify` and on moving `core.hooksPath` | The hook itself is broken and the human says the commit goes in anyway |
| `KJ_ALLOW_WRITE=1` | the Write-over-existing-file block (use Edit) | A full regeneration is exactly what was asked |

There is no `KJ_ALLOW_*` for security findings. That is the point.
