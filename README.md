<p align="center">
  <img src="docs/karajan-orbit.svg" alt="Karajan Code" width="220">
</p>

<h1 align="center">Karajan Code</h1>

<p align="center">
  The environment that governs AI-driven development — your agent orchestrates, Karajan governs.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@karajan-family/code"><img src="https://img.shields.io/npm/v/%40karajan-family%2Fcode.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@karajan-family/code"><img src="https://img.shields.io/npm/dw/%40karajan-family%2Fcode.svg" alt="npm downloads"></a>
  <a href="https://github.com/manufosela/karajan-code/actions"><img src="https://github.com/manufosela/karajan-code/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node.js"></a>
</p>

<p align="center">
  <a href="docs/README.es.md">Leer en Español</a> · <a href="https://karajancode.com">Documentation</a> · <a href="https://planning-game-xp.web.app/public/?project=Karajan%20Code">Public roadmap</a>
</p>

---

Your AI agent (Claude Code, Codex, Copilot, Antigravity, Cursor…) writes the code. **Karajan governs how it happens**: it installs a method your agent follows on every task, and enforces it with git gates that make a false green structurally impossible.

- **RAG before assuming** — `kj rag query` answers what your codebase does; no agent guesses. The install wires it as a native MCP tool (`kj_rag_query`) so querying the index is the agent's cheapest path. Works out of the box: local Ollama, or the built-in ONNX embedder when nothing can be installed; cloud embedders require an explicit sensitivity declaration and PII-redact every chunk. A distilled engineering canon rides along: `kj rag query --library` serves pattern cards (when it applies, when it does NOT, the canonical citation) so plans name a greenfield alternative instead of following the legacy line by inertia.
- **Card first, on YOUR board** — every piece of work is tracked before it starts: kj's HU Board (`kj hu add|move|list`), the Planning Game, or the board the project already uses (Linear, Trello, Jira, GitHub Issues) via your agent's own MCP/tools. Declared, verified at install, never optional — Karajan does not run without a board. ADRs live in git (`kj adr add|list`).
- **Tests prove behavior** — the failing test exists first; the suite is never left red.
- **Deterministic first, then cross-AI review** — `kj review --staged` runs SonarQube on the changed files before any AI opinion (BLOCKER/CRITICAL reject on the spot), then binds a verdict from a *different* AI to the sha256 of the exact diff — stamped with the workspace it ran from. Without an approved verdict, **the commit does not enter** (pre-commit gate).
- **A third AI arbitrates disputes** — `kj solomon` rules when brain and reviewer disagree. Security findings are never overridable — not even by arbitration.
- **Branch first, lanes for parallel work** — the base branch only moves through atomic PRs; `kj worktree start|list|done` gives each concurrent task its own isolated lane.
- **Least privilege for agents** — spawned agent subprocesses receive an env allowlist (their own CLI's auth, never your cloud keys or registry tokens), and `kj check` inventories every MCP the project can reach, flagging what appeared since the last check. Sensitive-surface tasks self-invoke `kj audit --security` — a zero-token pass (prompt-injection over the agent-context files + OSV + Semgrep + Sonar) — and remediate before review.
- **Nothing personal ships** — every outbound boundary audits before it leaves the machine: the pre-commit rejects a staged diff carrying your denylisted personal data, hardcoded platform tokens (`ghp_`, `sk-`, `AKIA`…) block outright, `verify-pack`-style tarball scans guard the publish, and `kj privacy scan <dir>` audits any build output. Your denylist lives in `~/.karajan/privacy.yml` — the install asks and writes it for you.
- **Installing IS activating** — `kj env install` performs the enforcement itself (git hooks, verdict gate, tool gate) instead of trusting the agent to run setup steps, and ends by printing the method into the very conversation that installed it. A commit outside the method is rejected, not narrated.
- **The turn cannot end red — the Sentinel** — a deterministic supervisor (zero LLM) wired into the harness's synchronous hooks records the method state of the session as tools run, and a Stop hook blocks the agent from ending its turn while method violations are open. The program rules, the agent thinks. See [guarantee levels](#guarantee-levels-governed-vs-supervised).
- **Trust expires — the Steward** — `kj steward sweep` checks the project's declared guarantees against their freshness and answers one of FOUR verdicts per invariant: ok, broken, *unknown* (evidence expired → refresh it) or *not observable* (nowhere to look → instrument it) — because confusing the last two with green is how a project decays for weeks behind a passing facade. The verdict is versioned in the repo, sealed in the decision chain, and every break lands on the board as PROPOSED work that nothing executes unreviewed. Runs on demand, on `kj resume` when stale, or as an opt-in scheduled Action.
- **The review panel never runs dry** — nine built-in agents (Claude Code, Codex, GitHub Copilot, Antigravity `agy` — the gemini successor —, Kimi Code, Qwen, OpenCode, Aider, Gemini legacy), and when the configured reviewer exhausts its quota, `kj review` switches to an authenticated candidate with a LOUD notice — or hands you the menu of candidates with their tier (free / subscription / local) and the exact login command. Never a silent failure, never the brain reviewing itself.

This repo runs under its own environment: every commit to karajan-code carries a cross-AI verdict.

## Install

Tell your agent — in the directory where you want to work:

```text
I want to use Karajan in this project: read https://karajancode.com/start.md
and do what it says.
```

The router prompt installs the full stack if needed, detects new vs existing project, activates the environment, and **stops to wait for you** whenever a step needs sudo or an account (`kj` exit code 3 = pending user action — a partial install is a failed install).

Manual equivalent:

```sh
curl -fsSL https://karajancode.com/install.sh | sh   # full product (npm-first; --standalone for CLI-only)
kj doctor && kj install-tools                        # complete the stack
kj init && kj env install && kj harden && kj review --install-gate
git config core.hooksPath .karajan/hooks
```

Requires git and at least one AI agent CLI — two enables cross-AI review; three enables arbitration. The npm route is `npm install -g @karajan-family/code` (published as `karajan-code` before joining the scope; the legacy name still installs the same versions). All install routes (npm, binaries, brew, Python wrapper) in the [install docs](https://karajancode.com/docs/v4/install/).

## The daily loop

1. You describe what you want. Your agent creates the card (`kj hu add`), queries the RAG, writes the failing test, then the code.
2. `kj review --staged` — a different AI reviews the exact diff. Approved → commit enters. Rejected → fix, or escalate to `kj solomon`.
3. Atomic PR to the base branch. `kj report` shows the trail; the HU Board (`kj board`) shows the work.
4. Your agent hits a kj bug? `kj report-issue` files it upstream — sanitized, deduped, and only with your approval. The ecosystem repairs itself.

Full method: [Work with your agent](https://karajancode.com/docs/v4/working-with-your-agent/) · [The gates](https://karajancode.com/docs/v4/gates/) · [Command reference](https://karajancode.com/docs/v4/commands/).

## Guarantee levels: governed vs supervised

Karajan **governs** any agent with git gates — the false green is structurally impossible no matter who writes, because the gates live in the repository, not in the agent's goodwill. On top of that, the **Karajan Sentinel** adds **supervision inside the turn**: `kj harden` wires deterministic hooks into the harness — one records the method state of the session as tools run (sources edited vs tests touched, escapes used), and a Stop hook blocks the agent from ending its turn while violations are open: sources edited on the base branch, a branch without a card, code without a single test touched. Every block states the exact violation and its remediation; `kj sentinel status` shows what the supervisor sees. It fails open — and says so — rather than ever hanging a session, and every `KJ_ALLOW_*` escape is recorded.

Synchronous blocking hooks exist today only in Claude Code. That makes the supported setup explicit: **to guarantee a harness that controls the LLM, use Claude Code as the host** — Claude writes, Codex reviews (a review subprocess needs no hooks), and a third CLI arbitrates when available. On any other host Karajan still governs at the full git-gate level and tells you which level is active — it never pretends a supervision it cannot enforce.

With a declared `.karajan/policy.yml`, the policy layer enforces at three tiers, and which tier applies depends on the host:

| Tier | Where | Requires | What it guarantees |
|---|---|---|---|
| **A — tool time** | Sentinel PreToolUse → `kj policy eval --strict` | Claude Code as host (synchronous hooks) | The rule fires BEFORE the damage; the acting agent's role travels in `KJ_POLICY_ROLE` |
| **B — commit time** | `kj review --staged` / pre-commit → deny + evidentiary exceptions | Any host (the gate lives in git) | The violating diff never enters, no matter who wrote it or what host ran it |
| **C — merge time** | `kj-policy.yml` CI workflow → `kj policy check --range --strict` | GitHub Actions (seeded by `kj harden`) | Covers a tampered local hook: the PR diff is re-checked against the same policy, merge-blocking |

Tier B is the guarantee floor — hosts without hooks lose A, never B; C re-verifies both. Security-class rules and consumer defaults are non-exemptable at every tier: no escape, no arbitration, no grant.

Every chokepoint decision lands in a hash-chained log (`kj policy anchor` seals its head in git), and `kj policy report` turns that log into evidence of process: per rule, how often it warned, denied or was exempted, which denials are still open, which grants are alive, expired or renewed — so a rule "gains teeth" on data, not on a hunch, and a renewed exception is read for what it is: the policy asking to change.

## Headless mode

The classic multiagent pipeline lives on for CI and automation: `kj run "<task>"` orchestrates coder/reviewer/tester subprocess roles unattended, with the same gates. Agents and CI pass `--non-interactive` (or `KJ_NON_INTERACTIVE=1`): safe gates auto-answer, FAIL findings stop the run with a real exit code. `kj advanced` lists the full surface. [Headless mode docs](https://karajancode.com/docs/v4/headless/).

## v3 (historical)

Karajan v1–v3 was a headless multiagent pipeline driven entirely by subprocess orchestration. Its full story — pipeline, 24 roles, MCP server, step mode, parallel lanes — is preserved in the **[v3 README (historical archive)](docs/README.v3.md)** and the [v3 docs archive](https://karajancode.com/docs/getting-started/introduction/).

## Contributing & license

Issues and PRs welcome — friction reports via `kj report-issue` are especially valuable. Licensed under [AGPL-3.0](LICENSE).
