---
name: working-with-karajan
description: How to develop in a repo governed by Karajan (kj) without fighting its gates - the order of a task, how to phrase commands the Sentinel accepts, reviews, human acts and when kj is wrong. Load it when you start work in a repo with a .karajan/ folder, or when a kj gate stops you.
---
<!-- kj:managed:working-with-karajan -->
# Working with Karajan

Karajan governs; you orchestrate. Its gates (git hooks, the Sentinel hooks of your host, CI)
enforce the method. A gate that stops you is telling you the next step: take it, never route
around it.

## The order of a task

1. Card first. `kj hu list`; if none fits, `kj hu add "<title in English>" --tier trivial|standard|deep`
   (add `--ref <id>` when the project mirrors cards in another tracker, and keep both moving).
   It opens a public issue: never a security-sensitive title.
2. Branch from the remote base, explicitly, with the card id in the name:
   `git checkout -b fix/HU-123-short-slug origin/main`. Without the id the Sentinel reads a card
   out of the slug and later asks you to move a card that does not exist.
3. Ask before assuming: `kj rag query "<question>"` before touching code you have not read in
   this session.
4. A failing test first, then the code, then the whole suite green.
5. Stage by name (never `git add -A`), check `git diff --cached --stat`, then
   `kj review --staged`. The verdict binds to that exact diff: change a byte, review again.
6. Validate the message before committing: header of 100 characters at most, lowercase subject,
   no AI attribution lines. `npx commitlint --edit <file>` when the repo has commitlint.
7. Commit, push, open the PR, then `kj review --publish-pr <n>` so the verdicts check finds it.
8. Merge only with CI green. Then `kj hu move <id> done` (and the replica in the other tracker,
   with its commits). The stop hook does not let a turn end with a merged card unmoved.

## Commands the Sentinel accepts

The Sentinel judges every tool call before it runs and refuses what it cannot verify:

- Literal absolute paths. No `cd` in a command that writes; no `$(...)`, backticks or
  variables in a command that writes, nor as the target of a redirect.
- A git command that switches or discards goes alone, not chained after another git command.
- Stage and commit in separate calls.
- Never name the supervisor files (the seal's provenance, the hooks) in a shell command; read
  them with your file tool.
- When the repo's rules ask for the account on every git or gh command, put it on every one,
  reads included.
- The delegate gate may stop the first edit of a card planned for `kj code`: run
  `kj code --card <id> --brief`, or try the edit again to write it yourself (it is recorded).
- Write only inside your own lane. Work that belongs to another repo or lane gets a card and an
  issue there, and you tell your user.

## Reviews

- A different AI reviews you. A rejection is the method working: apply it and review again, no
  apology. Disagree on substance: `kj solomon`.
- Never pass `--reviewer` by hand: without quota, kj falls back for that one review by itself.
- Rebased or amended after the review? Review the new commit (`kj review --range HEAD~1..HEAD`)
  before you push: CI checks the verdict of every commit, and force-push is refused.
- Auth, user input, secrets, network or dependencies: `kj audit --security` before the review.

## Human acts

`kj harden --commit`, `kj rules approve`, `kj release approve` and `kj identity enroll-phone`
are typed by your user in their own terminal; kj refuses them from an agent or a script.
Register each one with `kj handoff add '<exact command>' --why '<what for>'`, wait for it with
`kj handoff wait <id>` in the background, and say that you stopped and why.

## Decisions and size

- A choice the card's acceptance criteria do not cover is your user's: `kj adr add` it as
  proposed and ask, with your recommendation. Never bury it in a PR.
- About 150 net lines per PR, 200 at most: split before committing, not at the gate. Human docs
  do not count; AGENTS.md, templates and skills do. A file with its own line budget in its tests
  is fitted into it, never raised.

## When kj is wrong

A gate that looks wrong is reported, not bypassed: diagnose it and `kj report-issue` (ask your
user before `--publish`). Never edit policies, gate config or exclusions to get through. There is
no escape (ADR 0015): what is your user's (a seal, an approval, a grant) they type in their own
terminal.
