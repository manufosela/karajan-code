# Karajan — adopt Karajan in an EXISTING project (agent instructions)

Goal: this codebase keeps its history, tooling and conventions — Karajan
governs from here on without breaking anything that already works. Requires
kj on the machine
([install-machine.md](https://karajancode.com/install-machine.md) if not).
The HARD RULE from [start.md](https://karajancode.com/start.md) applies.

## 1. Respect what exists

- Work on a branch, never directly on the default branch.
- kj seeds configs only when NO variant exists (an `eslint.config.mjs`, a
  `.prettierrc`, a biome.json… all count as "exists"). If `kj harden`
  reports something as `covered` or `skipped`, that is correct behavior —
  do not force kj's defaults over the project's own.

## 2. Understand the codebase

```sh
kj onboard        # brownfield analysis → Architecture Brief
```

Read the brief before proposing anything.

## 3. Activate the environment

```sh
kj init                    # detects the stack; respects existing config
kj env install             # method into the rules files + RAG over the EXISTING code
kj harden                  # hooks; seed-if-absent, never eclipses real configs
kj review --install-gate   # commits now REQUIRE a cross-AI verdict
git config core.hooksPath .karajan/hooks
```

The RAG index over the existing code is the main prize: from now on you query
it (`kj rag query`) instead of guessing what the codebase does.

## 4. Contract via the project's own flow

Commit `.karajan/review-gate`, `.karajan/hooks/`, `.karajan/adrs/` and the
rules files through the project's normal flow (branch + PR if that is how
this repo works). Every teammate who pulls inherits the environment.

## 5. Hand over

Run `kj doctor`, summarize the Architecture Brief to the user, and ask what
to develop next. Track it with `kj hu add "<story>"` (card first) and work
under the method: RAG before assuming, tests first, cross-AI review before
every commit, atomic branch + PR.
