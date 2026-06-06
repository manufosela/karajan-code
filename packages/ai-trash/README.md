# @karajan/ai-trash

AI-proof trash: intercept destructive operations from an AI-driven shell
(`rm -rf`, truncation via `>`, `mv` overwriting, destructive `git` ops, …)
and snapshot the affected paths to a bin the AI cannot reach before the
command runs.

Status: **skeleton** — see Karajan epic `KJC-PCS-0041` and the planning
documents in `docs/ai-trash-fase1-report.md` + `docs/ai-trash-fase2-plan.md`
of the parent repo.

The MVP is being built incrementally (KJC-TSK-0388). This package currently
only ships the skeleton (`package.json`, `bin/kj-trash.js`, `src/index.js`).

## Why

Any flow where an LLM has shell access (Claude Code hooks, Cursor, Aider,
OpenCode, Devin, custom LangChain/AutoGen agents …) shares one risk: the
agent can issue `rm -rf` on a critical path and there is no undo. `ai-trash`
puts a snapshot in a place the agent cannot read, write, or `empty` —
restore is one command away; emptying the bin requires a human factor
(sudo / TTY / external token).

## Roadmap

1. Manifest + trash-store (ULID, TTL, LRU quota) — KJC-TSK-0388 commit 2
2. Logger append-only + permissions (linux + macOS) — commit 3
3. File / directory snapshotter (mv + reflink fallback cp) — commit 4
4. CLI `list / inspect / restore` + `bin/kj-trash` — commit 5
5. CLI `empty / purge` with TTY guard — commit 6
6. Destructive git ops (`reset --hard`, `push --force`, …) — KJC-TSK-0389
7. Claude Code `PreToolUse` adapter — KJC-TSK-0390
8. Wiring into `kj doctor` — KJC-TSK-0391

## License

AGPL-3.0 — same as Karajan Code.
