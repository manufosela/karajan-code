---
title: The Sentinel, gate by gate
description: Every message the Karajan Sentinel prints, what it protects, and where each project decision goes now that there are no escapes.
---

The Sentinel is the set of synchronous hooks `kj harden` installs in your agent's harness. Every message it prints starts with `karajan sentinel:` and ends with a link to its section on this page. The host harness may wrap it in its own words (Claude Code says "stop says", "PreToolUse hook error") — the body is Karajan's.

Two rules apply to everything below. First: the Sentinel blocks *before* the action runs — nothing is undone, because nothing happened. Second: there is no escape (ADR 0015). Each message names the remedy, and a decision that belongs to the project has its own channel outside the session (see [escapes](#escapes)).

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

Every block is sealed into the decision log, so "what did the Sentinel stop?" is a `kj policy report` away.

## card-first

Work needs a tracked card before it starts. Editing sources on the base branch, or on a branch whose name references no card, is blocked. Create the card (`kj hu add`), move it to running, and work on a `feat/<CARD-ID>-description` branch. No escape (ADR 0015).

## rag-first

The RAG must have answered about a zone before the session touches it (ADR 0010). Every `kj_rag_query` / `kj rag query` of the session leaves a ledger of the sources it returned; editing a source none of them returned (nor a sibling in its directory) is blocked with the query to run. A new file only needs the session to have consulted at all. Docs, config and tests stay out, like card-first. A file the index cannot hold, or an empty index, is decided by the gate itself. No escape (ADR 0015).

## cross-lane

Since MONO-0, each session mutates only its own worktree lane; reading is free. The guard also refuses mutations it cannot verify: `cd` in a mutator chain, command substitution, shell expansion, or redirections whose target hides behind a variable — use `git -C`, `npm --prefix` and literal paths. There is no escape (ADR 0015): a deliberate crossing is your user's, in their own terminal.

## identity

The identity lock (ADR 0005): `gh`, `git push` and commit-authoring commands must run under the account this clone declares (`kj identity set`). Born from a real incident — one unswitched `gh` call posted as a client account on a public repo. Escape: `KJ_ALLOW_IDENTITY=1`.

## board-sync

A merged card must be moved in the tracker before anything else advances — commit, push, new PR, another merge, or ending the turn. Clear it with the real tracker call (`update_card` via MCP, or `kj hu move`). An epic and a card split across PRs are decided by the gate. No escape (ADR 0015).

## policy

`.karajan/policy.yml` is evaluated on every tool call. A deny names its rule and reason. Security-tagged rules have NO escape and NO arbitration. The rest have no escape either (ADR 0015): a rule that misfires is fixed in `.karajan/policy.yml` by your user, through a PR.

## rules

The rules you wrote in your MD files (CLAUDE.md, AGENTS.md, your feedback memories), compiled into `.karajan/rules.yml`, are checked before every tool call, MCP tools included (ADR 0016). A rule is a condition over the call: which tool, with which arguments. "Sprints last one day" stops being something the agent has to remember: a call that creates a week-long sprint is denied before it runs, and the message names the rule, the MD it comes from and what it says. `kj rules list` shows every rule found in your MD files, `kj rules eval` evaluates one call, and `kj rules test` runs each rule's own examples.

`kj rules coverage` crosses every rule of your MD files with `rules.yml` and says what each one became: a deterministic gate, a judgment one, out of scope (a rule about how the agent thinks or answers, declared with its reason, has no tool call to gate) or nothing yet. A rule with no gate is listed by name, and so is a stale one: when you reword a rule in its MD, what was compiled for the old wording no longer matches any text. `--strict` exits 1 while either remains. You do not have to remember to run it: once a project has a `rules.yml`, every session start tells the agent how many rules have no gate and how many are stale.

Nobody writes `rules.yml` by hand, and the agent does not write it at all. `kj rules compile` writes the proposal's skeleton to `.karajan/rules.proposed.yml` (what is already approved, plus one entry per rule with no gate, with its id and its literal text) and hands your agent the format, with no model called by kj: the agent knows its own tools, so it is the one that can name them. It gives each entry its kind and its condition; `kj rules check` proves the result (every rule is one of your MD files, cites its literal text and passes its own examples), and `kj rules approve` shows you each rule next to what it was compiled to, and which rules leave, before it installs anything. Approving is a human act with the same layers as the supervisor's seal: no agent session runs it, and what lands is exactly what you were shown.

The approved rules live in two files, and where a rule goes is decided by where it is written, not by the proposal. A rule written in a file of the project (`CLAUDE.md`, `AGENTS.md`) goes to `.karajan/rules.yml`, which travels with the repo: the team inherits it. A rule written only in your private files (your global `CLAUDE.md`, your feedback memories) goes to `.karajan/rules.local.yml`, which git ignores, so approving your own rules never publishes your own words. Both govern as one rule set, and a session can write neither.

There is no escape. If a rule is compiled wrong, your user fixes `.karajan/rules.yml`, which a session cannot edit. A `rules.yml` that cannot be evaluated denies every call until it is fixed, because rules silently off would be every call allowed. With no `rules.yml`, this gate does not exist.

## steward

The Steward's sweep can declare the project state bad enough that starting new work is blocked (security invariants, persistently red main — only where the project opted in). Remedy what the report names. There is no escape (ADR 0015): if work must go on, your user sets `method_gates.steward` back to `inform`.

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

The lifted check stays red in the report, because the fact has not changed; it just stops blocking its own fix, and the gate says which item it lifted rather than doing it in silence. Any other red check still blocks. A package publication is never excused: `npm publish` and `gh release create` are irreversible, so no declared remedy covers them, and there is no escape (ADR 0015): what the check names is repaired first.

## commit-gate

The review runs in the commit hook, so a flag that skips the hook skips the verdict, the policy and the privacy scan with it. `git commit --no-verify` is denied, and so is any abbreviation git would accept (`--no-ver`, `-n`, a short-flag cluster carrying it). Naming `core.hooksPath` is denied too, in any of git's doors to it (`-c`, `config`, `--config-env`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_PARAMETERS`), because moving that key switches off every hook at once. Even reading it: exempting reads invited slipping one in behind the change, and reading it again costs you one escape while losing the gate costs the verdict.

If the hook is broken, fixing it is the answer. There is no escape (ADR 0015): if the commit really has to go in without it, your user runs it in their own terminal. The `--no-verify` that `kj harden --commit` uses internally is not affected, because it never goes through a tool call.

## supervisor

The Sentinel's own files (`.karajan/harness`, hooks) are read-only from inside a session — a supervisor a session can edit is no supervisor. Only the human dismantles or regenerates it (`kj harden`), outside the session. Tampering is detected against what the installed kj itself would write.

When they differ, kj tells three cases apart. If the file is exactly what `kj harden` wrote (it records a sha256 per file in `.karajan/harness/installed.json`) and no human sealed it, kj has simply moved on: it regenerates the file itself and says so in one line. If a human sealed it, it is left alone and you are told that advancing it is theirs. Anything else was changed after installation, and that blocks. Forging the record gains nothing: the only thing it enables is restoring the file from the installed kj.

## discard

A session does not discard changes it did not make. `git checkout -- <path>`, `git checkout <path>`, `git checkout .`, `git checkout -f`, `git restore` (of the working tree), `git reset --hard`, `git switch --discard-changes` and any `git clean` that is not a dry run are denied when what they would throw away includes a file the session did not own. A file is the session's own when it was clean, or did not exist, the first time the session touched it. An edit on top of your uncommitted work leaves the file yours, not the session's. For `git clean` the Sentinel asks git itself what would go (`git clean -n` with the same options), so ignored files under `-x` and nested repositories under `-ff` count too. `git stash drop` and `git stash clear` are always denied: saved work may not be the session's. A git discard nested in `$( )`, backticks, `eval`, `xargs` or `sh -c` cannot be read, so it is denied too: run it as a simple command.

There is no escape, because it is data loss. The remedy never loses anything: `git stash push -- <files>` puts the change aside, recoverable, and the session tells you. Born from a real loss: a coder decided a `.gitignore` line "was probably made by the system" and ran `git checkout .gitignore` over the user's change (issue #1886).

## bash-write

Inside the repo, files are written through the Edit and Write tools only, because that is the path every other gate guards (card-first, rag-first, no whole-file overwrite). A Bash command that writes a repo file is denied: redirections (`>`, `>>`, `>|`, `2>`), `tee`, `sed -i`, `perl -i`, `cp`, `mv`, `install`, `ln`, `dd of=`, `truncate` and `touch`, also behind `env`, `sudo` or `command`. A target the Sentinel cannot read (`$VAR`, backticks) is denied too. An inline script (`node -e`, `python -c`...) that names a write API is denied as well. Outside the repo (`/tmp`, a scratchpad, `/dev/null`) Bash stays free, and `git mv` renames inside it. The limit, said plainly: a program you run can write files (a script, a build), and a hook that reads commands cannot stop that; only a sandbox can. This gate closes the shell's own ways of writing, which is where an agent routes around Edit/Write. Born from a real bypass: blocked by rag-first, a coder wrote the same change with `cat >` heredocs, including a whole-file overwrite (issue #1886).

## reminders

An agent reads its rules when it starts and loses them when the context is compacted. A hook does not forget. After certain actions the Sentinel adds the rule that comes next to the agent's context. It never blocks. Each reminder is given at most once every 25 actions:

- after `git add`, the commit message limits (100 characters, lowercase subject, no attribution) and `commitlint`;
- after a `gh` without an account switch, to name the account in the same command;
- after `gh pr create`, to split an unfinished card before merging;
- after syncing `main`, to create the next branch now.

Each one comes after the action that precedes the rule's action, not before it, because a reminder before a tool call would have to approve that call and skip your permission prompt.

After a compaction or a resume, the Sentinel gives the agent back the project's critical rules, short, with the state of its session: branch, card, and cards merged but not yet moved. The first rule is that Karajan governs: an agent does not change policies, gate settings or exclusions to get past a gate. A new session gets nothing extra, since CLAUDE.md already brings the rules.

## governance

Karajan governs, and it is obeyed. A session does not change the rules that govern it: `.karajan/policy.yml`, `.karajan/kj.config.yml`, `.karajan/rules.yml` (the rules of the MD files compiled into gates, ADR 0016) and any `.ragignore` belong to the human, like the supervisor's own files, and Edit or Write on them is denied before any escape. If a gate looks wrong, the remedy is to propose the change to the user or file it with `kj report-issue`, never to loosen the rule. Every deny of the PreToolUse gate ends with the same line saying so.

## stop-gate

The turn cannot end while the method is red: suite failing, unreviewed diffs, pending board moves, unbacked claims. Resolve the listed violations. State: `kj sentinel status`.

## push-gate

Same as the stop gate, at the moment of `git push`: nothing leaves the machine with the method red.

## attribution

AI attribution is forbidden by a deterministic project rule — everywhere, with no escape. Three layers enforce it: the commit-msg hook rejects it in commit messages; the pre-commit hook scans the staged diff's ADDED lines (changelog, docs, code comments — tool *mentions* stay legal, attribution does not); and the Sentinel scans every `gh` command that publishes text (PR/issue/release create, edit, comment, review), including the contents of `--body-file`/`--notes-file` — an unreadable file does not publish either. CI re-checks commits, PR body and title. Born from a real catch: 15 PR bodies shipped an attribution footer because only commit messages were scanned (KJC-BUG-0164).

## escapes

There are none (ADR 0015). A gate that needs an escape is a gate to fix, and an exception the agent could raise for itself would not be an exception. Each decision that really is the project's has its own channel, outside the session:

| Case | Channel |
| --- | --- |
| A rule that misfires | your user fixes `.karajan/policy.yml` by PR |
| The Steward block must not stop work | your user sets `method_gates.steward` to `inform` |
| A large PR is justified | your user's `large-pr-justified` label, judged in CI |
| A privacy false positive | the `allow` list of `~/.karajan/privacy.yml` |
| A crossing between lanes, or a skipped hook | your user, in their own terminal |
