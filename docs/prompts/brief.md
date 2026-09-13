# Karajan — start a new build (agent instructions)

We are starting a project under the Karajan method. Before writing a line of
code, we first understand what we are building and leave it planned and
tracked. Requires Karajan installed in this project
([project-new.md](https://karajancode.com/project-new.md) if not).

## 1. Ask me for the spec

Ask me what I want to build. A good starting spec needs, even in two lines each:

- The problem and who it is for.
- What "done" looks like: what someone can do when it is finished (observable,
  not a loose list of features).
- Constraints: deadlines, budget, the platform or systems it must live with,
  what cannot be used.
- Non-goals: what we are explicitly not building now.

If any of this is missing, ask me. Do not assume it. How to write a spec:
[spec.md](https://karajancode.com/spec.md).

## 2. Propose what the spec does not decide

When the spec does not fix the architecture, platform, language or framework,
do not choose in silence: propose two options with a recommendation and why
(one of them as if the code did not exist, the greenfield solution), and record
it as a proposed ADR (`kj adr add`) for me to accept. Same with any design
decision the spec does not cover: it is mine, do not bury it in a PR.

## 3. Plan and tasks before code

- Turn the spec into a short plan: the steps, in order.
- Split the work into small, tracked tasks, each a card on the board
  (`kj hu add`) before you touch it. One card, one purpose.
- Note dependencies and what is out of scope.

## 4. Build under the method

Every task: query the RAG before assuming, a failing test first, a different AI
reviews the diff before the commit, an atomic branch and a small PR. Security
findings are never skipped. When in doubt about a decision, ask me.

Start by asking me for whatever the spec is missing.
