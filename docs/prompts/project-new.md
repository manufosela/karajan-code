# Karajan — activate a NEW project (agent instructions)

Goal: this empty (or nearly empty) directory becomes a Karajan-governed
project. Requires kj on the machine
([install-machine.md](https://karajancode.com/install-machine.md) if not).
The HARD RULE from [start.md](https://karajancode.com/start.md) applies.

## 1. Repository first

If there is no git repo yet: `git init` (ask the user about remote/hosting —
do not create a public repo without their explicit OK).

## 2. Activate the environment

```sh
kj init                    # config, rules, quality tooling (agent-safe without a TTY)
kj env install             # method into the rules files + builds the RAG index
kj harden                  # git hooks: lint, commit policy, review-gate runner
kj review --install-gate   # commits now REQUIRE a cross-AI verdict
git config core.hooksPath .karajan/hooks
```

`kj env install` exits 3 if the RAG cannot index (missing embedder) — stop
and wait, as always.

## 3. Commit the contract

Commit the generated contract files — `.karajan/review-gate`,
`.karajan/hooks/`, `.karajan/adrs/`, the agent rules files — so anyone who
clones inherits the environment (each clone repeats the `core.hooksPath`
config once).

## 4. Hand over

Run `kj doctor`, then ask the user what to build. Their answer becomes the
first tracked work: create it with `kj hu add "<story>"` (card first), and
develop it under the method — RAG before assuming, tests first, cross-AI
review before every commit, atomic branch + PR.
