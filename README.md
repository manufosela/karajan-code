<p align="center">
  <img src="docs/karajan-orbit.svg" alt="Karajan Code" width="220">
</p>

<h1 align="center">Karajan Code</h1>

<p align="center">
  Local multi-agent coding orchestrator. TDD-first, MCP-based, vanilla JavaScript.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/karajan-code"><img src="https://img.shields.io/npm/v/karajan-code.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/karajan-code"><img src="https://img.shields.io/npm/dw/karajan-code.svg" alt="npm downloads"></a>
  <a href="https://github.com/manufosela/karajan-code/actions"><img src="https://github.com/manufosela/karajan-code/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js"></a>
  <a href="https://github.com/manufosela/homebrew-tap"><img src="https://img.shields.io/badge/homebrew-tap-orange.svg" alt="Homebrew"></a>
</p>

<p align="center">
  <a href="docs/README.es.md">Leer en Español</a> · <a href="https://karajancode.com">Documentation</a>
</p>

---

> **v2.14.3 released** — Patch. Three preflight improvements surfaced by the first real `kj run` against a greenfield project (greta-app): (1) `gh` keyring auth is now recognized — Karajan no longer demands `GH_TOKEN` env var when the user has done `gh auth login --web` (KJC-BUG-0049 puntual). (2) New **degradable checks** system: when a preflight check fails on an optional feature (e.g. `auto_pr` without gh token), the feature is silently disabled with a WARN instead of aborting the entire run. (3) New **project-aware preflight**: detects signals (Dockerfile / firebase.json / pyproject.toml / Cargo.toml / *.tf / .env.example), checks the corresponding tools are installed, validates write permissions on `projectDir/.kj/.karajan`, compares `.env` vs `.env.example`, and validates `gh` push access to the actual remote (not just global auth). New command `kj doctor --project` runs only this phase. 2 PRs (#690, #691). 4608/4608 tests passing. Safe upgrade from 2.14.2.
>
> **v2.14.2** — Patch. More dogfooding fallout from GRETA Plan 2 v2.14.1: the **▶ Run button** on the HU Board appeared on every `pending` card regardless of `blocked_by` (you could launch a HU whose deps don't exist yet — the user caught it instantly), and titles on the board lost their **`[EPICA]` prefix** at some point in v2.14.x evolution, making it impossible to tell at a glance which area of the plan a card belonged to. Fixes: `canRunHu` now requires `blockedBy.length === 0` before showing ▶; the planner prompt now demands `description: "[EPICA] one-sentence description"` with INFRA/SHARED fallbacks. Plus a new doc `docs/task-templates/spec-conventions.md` collecting the 6 SPEC conventions the planner v2.14.x understands (épicas, scope exclusions, transversal deps, reuse, async observers, explicit deps), so users don't have to rediscover them by dogfooding. 2 PRs (#687, #688). 4584/4584 tests passing. Safe upgrade from 2.14.1.
>
> **v2.14.1** — Patch. Two more planner pathologies surfaced by dogfooding v2.14.0 against GRETA Plan 2: the **self-fix loop could regress** (iter 1 would drop 15→10 issues, iter 2 then deleted HUs the first iter had added, reaching 17 — worse than before iter 2 started) and the **planner declared `blocked_by` on async observers** (HUs that an async guardrail or cron *reacts to* were marked as depending on the guardrail, breaking the GRETA "AVISA-no-BLOQUEA" principle). Fixes: P5 snapshots the plan before each self-fix iter and reverts if `newCount > currentCount`; P6 lists six async-observer patterns in the planner prompt with a "consume vs react" heuristic. After P5+P6, regenerating Plan 2 GRETA returns to the baseline-iter-1 quality (9 findings) instead of v2.14.0's 17. 2 PRs (#684, #685). 4580/4580 tests passing. Safe upgrade from 2.14.0.
>
> **v2.14.0** — Quality pass. 16 PRs absorbing bug blockers (Solomon no longer rubber-stamps security issues misclassified as "style", coder filesystem-leak detection gains a second layer that catches `cd <abs> && pnpm init` even when the dir pre-existed, Sonar admin password rotation now surfaces silent failures), the four planner pathologies surfaced by the GRETA Plan 2 dogfooding (scope respect, transversal one-to-many deps, explicit `reuse` marker, and a brand-new **self-fix loop** where the plan-reviewer re-invokes the planner with structured feedback until zero issues remain), HU Board polish (zombie-TTL for crashed-runner prompts, less aggressive rate-limit with SSE exempt), and the first wave of `tests/` reorg (issue #368): ~93 files moved from root to mirror-subfolders. **4577/4577 tests passing**, **0 regressions** across all 16 PRs. Safe upgrade from 2.13.0.
>
> **v2.13.0** — HU Board hardening. Five PRs make the board resilient and self-healing after a dogfooding session uncovered four pathologies: a "Karajan needs an answer" prompt modal from days earlier blocking the entire UI, 18 zombi projects reappearing after every `kj board start`, the browser serving stale HTML/JS after a server restart, and the prompt modal showing a transparent background. Now: **tombstones** persist deletes across `fullScan` (`KJC-TSK-0380`), new endpoints `DELETE /api/prompts/:id`, `DELETE /api/plans/:planId`, `GET /api/tombstones`, `POST /api/tombstones/:type/:id/restore`; new command **`kj board cleanup`** sweeps ephemeral projects, orphan prompts and dangling session dirs in one pass; **`Cache-Control: no-store`** + `/api/version` polling auto-reloads the client when the server boot time changes; new **🧹 button** as manual escape hatch; CSS `--bg-secondary` finally declared so modals are opaque. 5 PRs (#654, #655, #656, #657, #658). 4522/4522 tests passing.
>
> **v2.12.0** — Quality-measurement release. Two new features land together: every `kj run` against a known plan now scores how faithfully the coder followed it (deterministic 0–100 **plan adherence** metric, four weighted components, rendered in `summary.md`), and a small **golden-tasks** regression suite (`todo-rest-api`, `npm-package-cli`, `react-counter-component`) catches output-quality drops between Karajan versions before npm publish. Plus the shrink-budget CI gate now exempts human-facing docs from its 200-LOC ceiling while keeping AI-rule files (CLAUDE.md, AGENTS.md, role prompts) capped. 3 PRs for plan adherence (#645–#647), 4 for golden tasks (#648, #650–#652), 1 for the CI policy (#649). 4522/4522 tests passing. Safe upgrade from 2.11.0.
>
> **v2.11.0** — Dogfooding pass release. Two-day pass through a 10-level test plan surfaced and fixed a long tail of UX papercuts and three latent bugs that only show up on fresh `/tmp` repos: the `SonarStage` no longer loops on remoteless projects (was burning iterations until `max_iterations`-fallback-approval), the post-loop `commitAll` now tolerates the locale-specific "nothing to commit" race, the HU sub-pipeline branches off `master`/`HEAD` when the configured `main` doesn't exist, and `runFlow` now seals `session.status` at the boundary so `kj status` never shows zombi `running` runs again. Plus `hu-board` gains automatic ephemeral-project cleanup and an in-UI help modal for the five views. 14 PRs (#624–#637), 4452/4452 tests passing. Safe upgrade from 2.10.2.
>
> **v2.10.2** — Patch release. `kj init` wizard expanded from 9 prompts to a full setup: per-role provider selection (10 roles, "inherit / pick CLI / disable"), automatic SonarQube token generation via REST API (no more web UI walkthrough), git automation flags (`auto_commit/push/pr`) and HU Board security (bind host + port). +16 new tests. Safe upgrade from 2.10.1.
>
> **v2.10.1** — Patch release. One-line fix for a stdout contamination bug in `kj audit --agent-readiness --json` (the `[info]` banner was breaking downstream `jq` pipes), plus polish in the asciinema demo scripts. Safe upgrade from 2.10.0.
>
> **v2.10.0** — Agent-readiness release. Karajan is now the first orchestrator with a full agent-readability surface: an `llms.txt` index at the root, a `SKILL.md` per CLI command under `docs/agents/`, and a static auditor that scores any third-party repo against the same shape. Highlights: (1) **`kj audit --agent-readiness`** scores any repo 0–100 across seven checks (llms.txt, robots AI-bot allowlist, page token budgets ≤ 32 KB, heading hierarchy, agents/README, SKILL.md coverage). LLM-free, deterministic, JSON-able. Karajan-on-Karajan: **100/100**. (2) **Six new SKILL.md files** (`kj doctor / init / board / review / resume / clean`) under `docs/agents/`, all with the same `What it does · Inputs · Outputs · Side effects · Failure modes · Example` contract; CI guards every link in `llms.txt` resolves. (3) **Webperf quality gate inside the iteration loop** (`pipeline.perf.enabled`): PASS continues, FAIL pushes blocking-metric feedback to the coder, scanner-missing skips best-effort. (4) **HU Board hardening**: binds 127.0.0.1 by default, opt-in `--bind 0.0.0.0` enforces an auto-generated token, helmet headers, rate limiting at 300 req/min — "safe by default on a coffee-shop WiFi". (5) **a11y skills auto-route**: tasks mentioning `accessibility / WCAG / ARIA / screen reader / keyboard nav` automatically pull the `frontend-ui-engineering` skill. (6) **Asciinema demo scripts** under `docs/demos/` so the recordings re-record per release instead of rotting. 5 PRs merged (#605–#609 + #610), 4358/4358 tests passing. See [CHANGELOG.md](./CHANGELOG.md) for the full punch list.

You describe what you want to build. Karajan orchestrates multiple AI agents to plan it, implement it, test it, review it with SonarQube, and iterate. No babysitting required.

## What is Karajan?

Karajan is a local coding orchestrator. It runs on your machine, uses your existing AI providers (Claude, Codex, Gemini, Aider, OpenCode), and coordinates a pipeline of specialized agents that work together on your code.

It is not a hosted service. It is not a VS Code extension. It is a tool you install once and use from the terminal or as an MCP server inside your AI agent.

The name comes from Herbert von Karajan, the conductor who believed that the best orchestras are made of great independent musicians who know exactly when to play and when to listen. Same idea, applied to AI agents.

## Why not just use Claude Code?

Claude Code is excellent. Use it for interactive, session-based coding.

Use Karajan when you want:

- **A repeatable, documented pipeline** that runs the same way every time
- **TDD by default.** Tests are written before implementation, not after
- **SonarQube integration.** Code quality gates as part of the flow, not an afterthought
- **Solomon as pipeline boss.** Every reviewer rejection is evaluated by a supervisor that decides if it's valid or just style noise
- **Multi-provider routing.** Claude as coder, Codex as reviewer, or any combination
- **Zero-config operation.** Auto-detects test frameworks, starts SonarQube, simplifies pipeline for trivial tasks
- **Composable role architecture.** Agent behaviors defined as plain markdown files that travel with your project
- **Local-first.** Your code, your keys, your machine. No data leaves unless you say so
- **Zero API costs.** Karajan uses AI agent CLIs (Claude Code, Codex, Gemini CLI), not APIs. You pay your existing subscription (Claude Pro, ChatGPT Plus), not per-token API fees

If Claude Code is a smart pair programmer, Karajan is the CI/CD pipeline for AI-assisted development. They work great together: Karajan is designed to be used as an MCP server inside Claude Code.

## How Karajan differs from AI frameworks

While Genkit, Mastra, LangChain and Vercel AI SDK call `/v1/messages`, Karajan orchestrates the AI CLIs your developers already use in their terminals.

| Axis | Karajan | Genkit / Mastra / LangChain / Vercel AI SDK |
|------|---------|---------------------------------------------|
| Calls provider HTTP API (`/v1/messages`, etc.) | ❌ Delegates to CLIs | ✅ |
| Orchestrates existing AI CLIs (claude, codex, gemini, aider, opencode) as subprocesses | ✅ | ❌ |
| Depends on cloud infrastructure | ❌ Fully local | ⚠️ Varies |
| Vanilla JS (no TypeScript required) | ✅ | ⚠️ TS-first |
| Token billing | **Uses your existing CLI subscriptions** | Pay per API call |

Two technical facts worth keeping straight:

1. **Subprocess, not PTY.** Karajan spawns each CLI via `execa` / `child_process` with plain `stdin` / `stdout` / `stderr` — see `src/infrastructure/command-runner.js` and `src/agents/*.js`. There is no PTY emulation.
2. **Fresh subprocess per invocation + state on disk.** Every coder run is a new process; the state lives in `~/.karajan/sessions/` (see `src/session-store.js`) and the per-session journal under `.reviews/<session-id>/`. This is what makes pipelines **reproducible** and **resumable** with `kj resume`.

Full write-up with mental mapping for Genkit / Mastra / LangChain / Vercel AI SDK developers: **[docs/COMPARISON.md](./docs/COMPARISON.md)**.

## Install

**npm** (recommended):
```bash
npm install -g karajan-code
```

**Homebrew** (macOS):
```bash
brew install manufosela/tap/karajan-code
```

**Standalone binary** (no Node.js needed):
```bash
# macOS (Apple Silicon)
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-darwin-arm64 -o kj && chmod +x kj

# Linux x64
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-linux-x64 -o kj && chmod +x kj

# Windows
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-win-x64.exe -o kj.exe
```

**One-liner** (detects OS, installs via npm):
```bash
curl -fsSL https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-kj.sh | sh
```

**Docker**:
```bash
docker run --rm -v $(pwd):/workspace karajan-code kj --version
```

**Python**:
```bash
cd wrappers/python && pip install .
```

That's it. `kj init` auto-detects your installed agents and installs RTK for token optimization.

### Optional scanners for `kj audit` + `kj webperf`

Karajan auto-skips any scanner that isn't installed. Add the ones that match your projects:

| Tool | Install | What you get |
|------|---------|--------------|
| **SonarQube** | `docker compose -f ~/sonarqube/docker-compose.yml up -d` | Code quality + security rules with line-precision in `kj audit` |
| **OSV-Scanner** | `go install github.com/google/osv-scanner@latest` | Dependency CVE coverage broader than `npm audit` |
| **Semgrep** | `pipx install semgrep` | SAST: XSS, SQLi, taint flow, secrets — equivalent to `snyk code`, free for OSS |
| **Lighthouse** | `npm install -g lighthouse` | Core Web Vitals + opportunities for `kj webperf` (auto-feeds `kj audit`) |

Skip any per-run with `--no-sonar`, `--no-osv`, `--no-semgrep`. See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md#optional-scanners--kj-audit--kj-webperf) for full table.

## Three ways to use Karajan

Karajan installs **three commands**: `kj`, `kj-tail`, and `karajan-mcp`.

### 1. CLI: direct from terminal

Run Karajan directly. You see the full pipeline output in real time.

```bash
kj run "Create a utility function that validates Spanish DNI numbers, with tests"
kj code "Add input validation to the signup form"     # Coder only
kj review "Check the authentication changes"           # Review current diff
kj audit "Full health analysis of this codebase"       # Read-only audit

# Planning workflow (v2.5+)
kj plan "Refactor the database layer"                  # Generate plan + HUs
kj plan list                                           # List plans for this project
kj plan show <planId>                                  # Show plan details + HU table
kj plan validate <planId>                              # Check structure and deps
kj plan ready <planId>                                 # Certify all HUs, mark ready
kj plan add-hu <planId> --title "..." --type feat      # Add HU to plan
kj plan remove-hu <planId> <huId>                      # Remove HU from plan
kj plan delete <planId>                                # Delete plan from disk
kj run --plan <planId> "task"                          # Execute an approved plan

# HU Board dashboard (v1.34.0+)
kj board start                                         # Start web dashboard (port 4000)
kj board open                                          # Start + open in browser
kj board status                                        # Check if running
kj board stop                                          # Stop the board
```

### 2. MCP: inside your AI agent

This is the primary use case. Karajan runs as an MCP server inside Claude Code, Codex, or Gemini. You ask your AI agent to do something, and it delegates the heavy lifting to Karajan's pipeline.

```
You → Claude Code → kj_run (via MCP) → triage → coder → sonar → reviewer → tester → security
```

The MCP server auto-registers during `npm install`. Your AI agent sees 23 tools (`kj_run`, `kj_code`, `kj_review`, etc.) and uses them as needed.

**The problem**: when Karajan runs inside an AI agent, you lose visibility. The agent shows you the final result, but not the pipeline stages, iterations, or Solomon decisions happening in real time.

### 3. kj-tail: monitor from a separate terminal

**This is the companion tool.** Open a second terminal in the **same project directory** where your AI agent is working, and run:

```bash
kj-tail
```

You'll see the live pipeline output (stages, results, iterations, errors) as they happen. Same view as running `kj run` directly.

```
kj-tail                  # Follow pipeline in real time (default)
kj-tail -v               # Verbose: include agent heartbeats and budget
kj-tail -t               # Show timestamps
kj-tail -s               # Snapshot: show current log and exit
kj-tail -n 50            # Show last 50 lines then follow
kj-tail --help           # Full options
```

> **Important**: `kj-tail` must run from the same directory where the AI agent is executing. It reads `<project>/.kj/run.log`, which is created when Karajan starts a pipeline via MCP.

**Typical workflow:**

```
Terminal 1                       Terminal 2

$ claude                         $ kj-tail
> implement the next
  priority task                  [triage]     medium (sw)
                                 [researcher] 3 patterns, 5 constraints
(Claude calls kj_run             [planner]    6 steps (tests first)
 via MCP, you see                [coder]      3 endpoints + 18 tests
 only the final result)          [tdd]        PASS (3 src, 2 test)
                                 [sonar]      Quality gate OK
                                 [reviewer]   REJECTED (2 blocking)
                                 [solomon]    2 conditions
                                 [coder]      fixed, 22 tests now
                                 [reviewer]   APPROVED
                                 [tester]     94% coverage, 22 tests
                                 [security]   passed
                                 Result: APPROVED
```

[**Watch the full pipeline demo**](https://karajancode.com#demo): triage, architecture, TDD, SonarQube, code review, Solomon arbitration, security audit.

## The pipeline

```
hu-reviewer? → triage → domain-curator? → discover? → architect? → planner? → coder → sonar? → impeccable? → reviewer → tester? → security? → solomon → commiter?
```

**16 roles**, each executed by the AI agent you choose:

| Role | What it does | Default |
|------|-------------|---------|
| **hu-reviewer** | Certifies user stories before coding (6 dimensions, 7 antipatterns) | Auto (medium/complex) |
| **triage** | Classifies complexity, activates roles, detects domain hints | **On** |
| **domain-curator** | Discovers, proposes and synthesizes business-domain knowledge for the pipeline | Auto (when domains exist) |
| **discover** | Detects gaps in requirements (Mom Test, Wendel, JTBD) | Off |
| **architect** | Designs solution architecture before planning | Off |
| **planner** | Generates structured implementation plans | Off |
| **coder** | Writes code and tests following TDD methodology | **Always on** |
| **refactorer** | Improves code clarity without changing behavior | Off |
| **sonar** | SonarQube static analysis with quality gate enforcement | On (auto-managed) |
| **impeccable** | UI/UX audit for frontend tasks (a11y, performance, theming) | Auto (frontend) |
| **reviewer** | Code review with configurable strictness profiles | **Always on** |
| **tester** | Test quality gate and coverage verification | **On** |
| **security** | OWASP security audit | **On** |
| **solomon** | Pipeline boss: evaluates every rejection, overrides style-only blocks | **On** |
| **commiter** | Git commit, push, and PR automation after approval | Off |
| **audit** | Read-only codebase health analysis (5 dimensions, A-F scores) | Standalone |

## 5 AI agents supported

| Agent | CLI | Install |
|-------|-----|---------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | See [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pipx install aider-chat` (or `pip3 install aider-chat`) |
| **OpenCode** | `opencode` | See [OpenCode docs](https://github.com/nicepkg/opencode) |

Mix and match. Use Claude as coder and Codex as reviewer. Karajan auto-detects installed agents during `kj init`.

## MCP server (23 tools)

After `npm install -g karajan-code`, the MCP server auto-registers in Claude and Codex. Manual config if needed:

```bash
# Claude: add to ~/.claude.json → "mcpServers":
# { "karajan-mcp": { "command": "karajan-mcp" } }

# Codex: add to ~/.codex/config.toml → [mcp_servers."karajan-mcp"]
# command = "karajan-mcp"
```

**24 tools** available: `kj_run`, `kj_code`, `kj_review`, `kj_plan`, `kj_board`, `kj_audit`, `kj_scan`, `kj_doctor`, `kj_config`, `kj_report`, `kj_resume`, `kj_roles`, `kj_agents`, `kj_preflight`, `kj_status`, `kj_init`, `kj_discover`, `kj_triage`, `kj_researcher`, `kj_architect`, `kj_impeccable`, `kj_hu`, `kj_skills`, `kj_suggest`.

Use `kj-tail` in a separate terminal to see what the pipeline is doing in real time (see [Three ways to use Karajan](#three-ways-to-use-karajan)).

## The role architecture

Every role in Karajan is defined by a markdown file: a plain document that describes how the agent should behave, what to check, and what good output looks like.

```
.karajan/roles/         # Project overrides (optional)
~/.karajan/roles/       # Global overrides (optional)
templates/roles/        # Built-in defaults (shipped with package)
```

You can override any built-in role or create new ones. No code required. The agents read the role files and adapt their behavior. Encode your team's conventions, domain rules, and quality standards, and every run of Karajan applies them automatically.

Use `kj roles show <role>` to inspect any template.

## Zero-config by design

Karajan auto-detects and auto-configures everything it can:

- **TDD**: Detects test framework for 12 languages (vitest, jest, JUnit, pytest, go test, cargo test, and more). Auto-enables TDD for code tasks, skips for doc/infra
- **Bootstrap gate**: Validates all prerequisites (git repo, remote, config, agents, SonarQube) before any tool runs. Fails hard with actionable fix instructions, never silently degrades
- **Injection guard**: Scans diffs for prompt injection before AI review. Detects directive overrides, invisible Unicode, oversized comment payloads. Also runs as a GitHub Action on every PR
- **SonarQube**: Auto-starts Docker container, waits up to 60s for startup, generates config if missing
- **Pipeline complexity**: Triage classifies task → trivial tasks skip reviewer loop
- **Provider outages**: Retries on 500/502/503/504 with backoff (same as rate limits)
- **Coverage**: Coverage-only quality gate failures treated as advisory
- **HU Manager**: Complex tasks auto-decompose into formal user stories with dependencies. Each HU runs as its own sub-pipeline with state tracking visible in the HU Board

No per-project configuration required. If you want to customize, config is layered: session > project > global.

## Why vanilla JavaScript?

Not nostalgia, not stubbornness. I've been using JavaScript since 1997, when Brendan Eich created it in a week and changed the lives of everyone building for the web. I know its guts, its bugs, its quirks. And I know that whoever truly understands JS turns those bugs into features. TypeScript exists so that developers used to strongly-typed languages don't panic when they see JS. I respect that. But I don't need it. Tests are my type safety. JSDoc and a good IDE are my intellisense. And not having a compiler between the code and me is what lets me ship 57 releases in 45 days without fear.

[Why vanilla JavaScript: the long version](docs/why-vanilla-js.md)

## Recommended companions

| Tool | Why |
|------|-----|
| [**RTK**](https://github.com/rtk-ai/rtk) | Reduces token consumption by 60-90% on Bash command outputs |
| [**Planning Game MCP**](https://github.com/manufosela/planning-game-xp-mcp) | Agile project management (tasks, sprints, estimation), XP-native |
| [**GitHub MCP**](https://github.com/github/github-mcp-server) | Create PRs, manage issues directly from the agent |
| [**Chrome DevTools MCP**](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Verify UI changes visually after frontend modifications |

## Contributing

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
npm install
npm test              # Run ~2599 tests with Vitest
npm run validate      # Lint + test
```

Issues and pull requests welcome. If something doesn't work as documented, [open an issue](https://github.com/manufosela/karajan-code/issues). That's the most useful contribution at this stage.

## Telemetry

Karajan collects anonymous usage statistics to improve the tool:
version, OS, command used, pipeline duration and success rate.
No code, task descriptions, or personal data is ever sent.

Opt out: set `telemetry: false` in `~/.karajan/kj.config.yml`

## Links

- [Website](https://karajancode.com) (also [kj-code.com](https://kj-code.com))
- [Full documentation](https://karajancode.com/docs/)
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [License (AGPL-3.0)](LICENSE)

---

Built by [@manufosela](https://github.com/manufosela). Head of Engineering at Geniova Technologies, co-organizer of NodeJS Madrid, author of [Liderazgo Afectivo](https://www.liderazgoafectivo.com). 90+ npm packages published.

### Contributors

- [@aitormf](https://github.com/aitormf) — OpenCode agent (5th built-in agent)
- [@reiaguilera](https://github.com/reiaguilera) — Beta testing, feature proposals, and quality feedback
