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
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node.js"></a>
  <a href="https://github.com/manufosela/homebrew-tap"><img src="https://img.shields.io/badge/homebrew-tap-orange.svg" alt="Homebrew"></a>
</p>

<p align="center">
  <a href="docs/README.es.md">Leer en Español</a> · <a href="https://karajancode.com">Documentation</a> · <a href="https://planning-game-xp.web.app/public/?project=Karajan%20Code">Public roadmap</a>
</p>

---

> **v3.7.1 released** — Patch: fixes a `kj init` crash when configuring the Plan B fallback, and makes pnpm installs safe — `kj doctor` now flags when pnpm skipped `better-sqlite3`'s native build and tells you exactly how to fix it (`pnpm approve-builds better-sqlite3`). The release gate checks pnpm too. Built on **v3.7.0 — Autonomous delivery**: `kj autorun <spec>` chains spec → plan → run every user story → outcome in one command, unattended, with an **Arbiter** that resolves agent conflicts by picking the least-bad call; autonomy is opt-in, interactive runs are unchanged. Full notes in [CHANGELOG.md](CHANGELOG.md).

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
| Token billing | **Uses your existing CLI subscriptions** | Pay per API call |

Two technical facts worth keeping straight:

1. **Subprocess, not PTY.** Karajan spawns each CLI via `execa` / `child_process` with plain `stdin` / `stdout` / `stderr` — see `src/infrastructure/command-runner.js` and `src/agents/*.js`. There is no PTY emulation.
2. **Fresh subprocess per invocation + state on disk.** Every coder run is a new process; the state lives in `~/.karajan/sessions/` (see `src/session-store.js`) and the per-session journal under `.reviews/<session-id>/`. This is what makes pipelines **reproducible** and **resumable** with `kj resume`.

Full write-up with mental mapping for Genkit / Mastra / LangChain / Vercel AI SDK developers: **[docs/COMPARISON.md](./docs/COMPARISON.md)**.

## Loop engineering

Prompt engineering got one good answer from one good prompt. Context engineering
curated what the model saw. The 2026 frontier is **loop engineering**: you stop
prompting the agent by hand and design the control system that prompts it, checks
it, and decides what happens next — until the goal is met or it hands back to you.

Karajan is a loop-engineering runtime, built around the loop before the term
caught on:

- **Maker / checker split** — a coder against independent reviewer / tester /
  security roles, with Solomon judging disputes. The maker never grades its own work.
- **Deterministic verification** — TDD, per-HU acceptance tests, SonarQube gates,
  and deterministic guards. Checking is tests, not vibes.
- **The autonomy ladder (L1 → L2 → L3)** — the `interactive | assisted |
  autonomous` axis (v3.7.0). Report, then assisted fixes, then unattended
  `kj autorun` — defaulting to `interactive`, so you opt in.
- **A durable state spine** — sessions, the HU Board, journals, the RAG index and
  `kj resume` keep the loop alive outside any one conversation.

The honest caveat loop engineering insists on — *unattended loops make unattended
mistakes* — is designed in: autonomous runs list their residual defects, every HU
lands behind a PR, and `kj-trash` snapshots destructive operations.

Full mapping of the loop-engineering building blocks onto Karajan:
**[docs/loop-engineering.md](./docs/loop-engineering.md)**.

## Install

**npm** (recommended):
```bash
npm install -g karajan-code
```

**Homebrew** (macOS):
```bash
brew install manufosela/tap/karajan-code
```

> **Installing with pnpm?** pnpm blocks dependency build scripts by default, so `better-sqlite3`'s native addon won't compile on install and DB-backed commands (`board`, `rag`, cost tracking) will fail. After installing, run `pnpm approve-builds better-sqlite3` — or just use npm. `kj doctor` flags this if it happens.

**Standalone binary** (no Node.js needed):
```bash
# macOS (Apple Silicon)
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-darwin-arm64 -o kj && chmod +x kj

# Linux x64
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-linux-x64 -o kj && chmod +x kj

# Windows
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-win-x64.exe -o kj.exe
```

**One-liner, binary** (no Node — detects OS/arch, verifies the checksum, installs to `~/.local/bin`):
```bash
curl -fsSL https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-binary.sh | sh
```
Pin a version or install dir with env vars: `KJ_VERSION=v3.7.2 KJ_INSTALL_DIR=/usr/local/bin`.

**One-liner, binary — Windows** (no Node — verifies the checksum, installs to `%LOCALAPPDATA%\Karajan` and adds it to your user PATH):
```powershell
irm https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-binary.ps1 | iex
```

> **If your OS blocks the binary.** The macOS build is ad-hoc signed and the
> Windows build is unsigned — neither carries a paid certificate, so a manually
> downloaded binary may be blocked on first run. The install scripts above clear
> the flag for you. If you download the binary by hand instead:
> - **macOS** — Gatekeeper says the binary "cannot be opened": `xattr -d com.apple.quarantine ./kj`, or Control-click the file → **Open**.
> - **Windows** — SmartScreen shows "Windows protected your PC": click **More info → Run anyway**, or run `Unblock-File .\kj.exe`.
>
> Paid notarization (Apple) and Authenticode signing (Windows) are optional and
> not enabled by default — this is a deliberate cost decision, not an oversight.

**One-liner, npm** (detects OS, installs via npm — needs Node ≥ 18):
```bash
curl -fsSL https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-kj.sh | sh
```

**Docker**:
```bash
docker run --rm -v $(pwd):/workspace karajan-code kj --version
```

**Python**:

The Python wrapper is a thin shim over the `kj` binary, useful when your stack lives in `pyproject.toml` / `requirements.txt` and you want to invoke Karajan from a venv.

```bash
# Option A — once published to PyPI (recommended)
pip install karajan-code

# Option B — install from the cloned repo (dev)
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code/wrappers/python
pip install .
```

Both options expect the `kj` binary to be on your `PATH` (via one of the methods above) — the Python wrapper does not vendor it.

That's it. `kj init` auto-detects your installed agents and installs the bundled integrations (RTK + Squeezr for token optimization; QMD for the per-project semantic wiki).

### Optional scanners for `kj audit` + `kj webperf`

None of these are required. Karajan auto-skips any scanner that isn't installed, so the pipeline runs fine with zero of them. Add the ones that match your projects to get more signal:

| Tool | Scope | Install | Installable from `kj init`? | What you get |
|------|-------|---------|-----------------------------|--------------|
| **SonarQube** | Any stack | `docker compose -f ~/sonarqube/docker-compose.yml up -d` | ✅ Yes (wizard configures Docker container + token) | Code quality + security rules with line-precision in `kj audit` |
| **OSV-Scanner** | Any stack | `go install github.com/google/osv-scanner@latest` | ❌ No (install manually) | Dependency CVE coverage broader than `npm audit` |
| **Semgrep** | Any stack | `pipx install semgrep` | ❌ No (install manually) | SAST: XSS, SQLi, taint flow, secrets — equivalent to `snyk code`, free for OSS |
| **Lighthouse** | **Frontend only** | `npm install -g lighthouse` | ❌ No (install manually) | Core Web Vitals + opportunities for `kj webperf` (auto-feeds `kj audit`) |

Skip any per-run with `--no-sonar`, `--no-osv`, `--no-semgrep`. See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md#optional-scanners--kj-audit--kj-webperf) for full table.

## Footprint & hardware requirements

Karajan ships as **layers you opt into**. The base CLI is tiny (~5 MB). Heavier pieces — Ollama for local RAG, SonarQube for static analysis, the `qmd` model cache for global semantic search — are only pulled if you ask for them. None of them are pulled during `npm install`.

### What lives where

| Layer | Size | When you pay it | Notes |
| --- | --- | --- | --- |
| `karajan-code` npm tarball | 5.2 MB / 555 files | Always | The CLI itself |
| `node_modules/` (global) | ~208 MB | After `npm install -g karajan-code` | Standard for any Node global; SEA binary skips it |
| `~/.karajan/` (state) | ~40 MB typical | After first `kj run` | Sessions, plans, audit history, HU board DB. `kj clean` prunes it |
| Ollama Docker image | 6.55 GB | If you use the **local** RAG embedder (default since v2.26) | Auto-pulled in the background on first `kj rag index` (~5 min) |
| Ollama embedding model | ~260 MB | First `kj rag index` | `nomic-embed-text` by default; lives inside the Ollama container |
| SonarQube Docker image | 1.47 GB | If you enable Sonar in `kj init` | Optional; `kj audit` runs fine without it |
| `qmd` model cache | ~2.2 GB | If you use `qmd query` for global semantic search | Local LLMs for query expansion + rerank; entirely off-box otherwise |

### Three install profiles

| Profile | Disk | What's enabled | Trade-off |
| --- | --- | --- | --- |
| **Minimum** | ~250 MB | `kj`, audits, reviews, RAG with **cloud embedder** (OpenAI / Voyage / Cohere / Mistral) | Needs an API key; no offline RAG |
| **Recommended** | ~8.5 GB | + Ollama (local RAG, no API key) + SonarQube | Offline-capable; needs Docker running |
| **Full house** | ~11 GB | + `qmd` (semantic search across personal docs/memory) | All features local; biggest footprint |

### Hardware

| Profile | CPU | RAM | Free disk | Notes |
| --- | --- | --- | --- | --- |
| **Minimum** | 2 cores | 4 GB | 1 GB | Cloud embedder only; pipeline peaks ~1 GB RAM |
| **Recommended** | 4–8 cores | 8–12 GB | 10–15 GB | Docker + Ollama running in background |
| **Ideal** | 16+ cores | 32+ GB | 50+ GB | Multiple Docker stacks, large repos, big audit history |

### Operational notes

- **No GPU required.** Embeddings are CPU-only by default; cloud embedders push the compute off-box entirely.
- **Pipeline RAM peak**: 1–2 GB per `kj run` (one orchestrator + one coder + one reviewer subprocess at a time).
- **SQLite is in-process.** No separate DB daemon. `~/.karajan/` is a folder, not a service.
- **First-run Ollama pull**: ~5 min in the background; you can keep working — `kj` falls back to a cloud embedder if Ollama isn't ready yet.
- **Runtime**: Node.js ≥ 22.22.1 (Active LTS). v3.0.0 dropped Node 20 support. Use `kj doctor` to verify your environment.

## Two ways to use Karajan

Karajan installs **three commands**: `kj` (the CLI), `karajan-mcp` (the MCP server) and `kj-tail` (a monitoring companion). There are two *ways to use it* — CLI or MCP — and `kj-tail` is the monitor you keep open in a second terminal while either mode is running.

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

# Quality guardrails
kj harden                                              # Install hooks, config, CI, guidelines
kj check                                               # Verify the harness (drift gate)
kj mutate                                              # Mutation-test the diff (do tests catch mutants?)
```

**Mutation testing** (`kj mutate`) closes the gap coverage leaves: it flips the
logic of the code you just changed and reruns your suite, so a line that ran but
isn't really tested shows up as a **survivor**. It is diff-scoped by default
(vs `HEAD~1`), drives the right runner per stack (Stryker/mutmut/Infection/…
with no silent fallback), and folds into a workflow three ways — on demand,
as an opt-in reviewer signal (`KJ_REVIEW_MUTATION=1`), or as a non-blocking
nightly CI job (`kj harden --mutation`). See
[GETTING-STARTED](docs/GETTING-STARTED.md#mutation-testing--kj-mutate).

### 2. MCP: inside your AI agent

This is the primary use case. Karajan runs as an MCP server inside Claude Code, Codex, or Gemini. You ask your AI agent to do something, and it delegates the heavy lifting to Karajan's pipeline.

```
You → Claude Code → kj_run (via MCP) → triage → coder → sonar → reviewer → tester → security
```

The MCP server auto-registers during `npm install`. Your AI agent sees 27 tools (`kj_run`, `kj_code`, `kj_review`, etc.) and uses them as needed.

**The problem**: when Karajan runs inside an AI agent, you lose visibility. The agent shows you the final result, but not the pipeline stages, iterations, or Solomon decisions happening in real time.

### Companion: `kj-tail` (monitor from a separate terminal)

`kj-tail` is **not a third way to run Karajan** — it's a read-only monitor for whichever of the two ways above you're using. Open a second terminal in the **same project directory** where the pipeline is running, and run:

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
pre-loop:  intent → hu-reviewer? → triage? → domain-curator? → discover? → skills? → researcher? → architect? → planner? → acceptance?
iteration: coder → refactorer? → guard(output) → guard(perf) → sonar? → tdd → reviewer → solomon? → brain?   (loops 1..N)
post-loop: tester? → security? → perf? → impeccable? → audit?
```

**24 stages max** across three phases: 18 AI-agent-backed roles (table below), 6 deterministic stages without an LLM call (`intent`, `skills`, `acceptance`, `guard(output)`, `guard(perf)`, `tdd`). Two extra classes (`commiter`, `repairer`) are post-approval / internal helpers, not standalone pipeline stages.

> **Karajan is multi-language.** The 24 figure is the upper bound for a frontend project. On a **backend / library / CLI** task, three stages are skipped automatically because they have nothing to assess: `impeccable` (UI/UX audit), `perf` (Core Web Vitals via Lighthouse) and `guard(perf)` (frontend anti-pattern check). That leaves a typical pipeline at **~21 stages** for backend / systems / CLI / data work, with the same triage rules trimming further on trivial tasks. Stage selection is auto-detected from the repo (presence of frontend frameworks, `index.html`, `package.json` browser fields, etc.) — no flag required.
>
> The **minimum useful pipeline** on a `trivial` task is roughly: `intent → triage → coder → guard(output) → tdd → reviewer → brain` (~7 stages). Triage decides.

Each AI role is executed by the agent you choose:

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
| **researcher** | Investigates the codebase before planning (file map + signatures + related tests) | Off |
| **perf** | WebPerf quality gate — Core Web Vitals (LCP, CLS, INP) via Lighthouse | Off |
| **brain** | Central AI orchestrator: routing, feedback enrichment, output compression | **On** |
| **audit** | Read-only codebase health analysis (5 dimensions, A-F scores) | Standalone |

> **Deterministic stages (no class):** `intent` (task-type classifier — `sw` / `infra` / `doc` / `add-tests` / `refactor` / `audit`), `skills` (slash-command surface), `acceptance` (executable acceptance tests), `guard(output)` (destructive ops + credential leaks), `guard(perf)` (frontend anti-patterns), `tdd` (test-coverage check).
>
> **Internal helpers (have a class, not a standalone stage):** `commiter` (git automation post-approval), `repairer` (repairs broken acceptance tests at runtime, invoked by `acceptance` / `tdd`).
>
> Full per-stage reference: [Pipeline roles](https://karajan-code.web.app/docs/handbook/pipeline-roles/) (handbook).

## 5 AI agents supported

| Agent | CLI | Install |
|-------|-----|---------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | See [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pipx install aider-chat` (or `pip3 install aider-chat`) |
| **OpenCode** | `opencode` | See [OpenCode docs](https://github.com/nicepkg/opencode) |

Mix and match. Use Claude as coder and Codex as reviewer. Karajan auto-detects installed agents during `kj init`.

## MCP server (27 tools)

After `npm install -g karajan-code`, the MCP server auto-registers in Claude and Codex. Manual config if needed:

```bash
# Claude: add to ~/.claude.json → "mcpServers":
# { "karajan-mcp": { "command": "karajan-mcp" } }

# Codex: add to ~/.codex/config.toml → [mcp_servers."karajan-mcp"]
# command = "karajan-mcp"
```

**27 tools** available: `kj_run`, `kj_code`, `kj_review`, `kj_plan`, `kj_board`, `kj_audit`, `kj_scan`, `kj_doctor`, `kj_config`, `kj_report`, `kj_resume`, `kj_roles`, `kj_agents`, `kj_preflight`, `kj_status`, `kj_init`, `kj_discover`, `kj_triage`, `kj_researcher`, `kj_architect`, `kj_hu`, `kj_skills`, `kj_suggest`, `kj_undo`, `kj_clean`, `kj_rag_query`, `kj_rag_index`.

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

## Bundled integrations

These ship with Karajan and `kj init` installs them as part of setup. They're token-efficiency layers the pipeline depends on — not nice-to-haves.

| Tool | Invoked by | Why |
|------|-----------|-----|
| [**RTK**](https://github.com/rtk-ai/rtk) | Karajan (auto, on Bash outputs) | Reduces token consumption by 60-90% on Bash command outputs |
| [**Squeezr**](https://www.npmjs.com/package/squeezr-ai) | Karajan (auto, on agent tool outputs) | Compresses verbose tool results before they reach the agent context |
| [**QMD**](https://github.com/manufosela/qmd) | Karajan (`kj init` auto-registers `docs/`, `.reviews/`, `.karajan/plans/`); you (via `kj qmd query`) | Per-project semantic wiki for **humans**. Complements the **agent-facing** RAG index — `kj rag query` is what the pipeline reads; `kj qmd query` is what you read |

## Recommended companions

None of these are required. Karajan runs fine on its own. They're tools that, when present, Karajan can take advantage of — or that help *you* work better around Karajan.

| Tool | Invoked by | Why |
|------|-----------|-----|
| [**GitHub MCP**](https://github.com/github/github-mcp-server) | Your AI agent (via MCP) | Create PRs, manage issues directly from the agent |
| [**Chrome DevTools MCP**](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Your AI agent (via MCP) | Verify UI changes visually after frontend modifications |

## Why vanilla JavaScript?

Tests are the type safety; JSDoc + a good IDE are the intellisense; no compiler in the loop is what makes shipping fast. The long version is anecdotal and lives in [docs/why-vanilla-js.md](docs/why-vanilla-js.md).

## Contributing

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
npm install
npm test              # Run ~5 368 tests across 482 files with Vitest
npm run validate      # Lint + test
```

Issues and pull requests welcome. If something doesn't work as documented, [open an issue](https://github.com/manufosela/karajan-code/issues). That's the most useful contribution at this stage.

## Privacy & telemetry

**Telemetry is OFF by default.** The `kj init` wizard asks once, in your OS
language, with a plain-text "yes / no" prompt:

> *Help improve Karajan by sending anonymous telemetry to the project?*
> *(version, OS, commands, pipeline duration — no code, no tasks, no personal data)*

Answer "yes" once and `telemetry: true` is persisted to `~/.karajan/kj.config.yml`.
Anything else — undefined, missing key, `false`, fresh install with no wizard run —
keeps it off. There is no hidden default-on path.

### What gets sent (when enabled)

Three event types, anonymous, no userID / email / IP collected by Karajan itself:

| Event | When | Payload |
|---|---|---|
| `install` | first `kj init` | `version`, `os`, `node`, `ts` |
| `cli_command` | each `kj <subcommand>` | `version`, `os`, `node`, `ts`, `command` |
| `pipeline_complete` | end of `kj run` | `version`, `os`, `node`, `ts`, `mode`, `agent`, `duration_s`, `success`, `taskType` |

Endpoint: `https://karajan-code.web.app/api/telemetry` (POST, 3 s timeout, fire-and-forget).
Implementation: [`src/utils/telemetry.js`](src/utils/telemetry.js).

### Flip it later

Open `~/.karajan/kj.config.yml`, set `telemetry: true` (opt in) or `telemetry: false` (opt out),
save. Or re-run `kj init` and answer the prompt again. Set `KJ_DEBUG=1` to see telemetry
errors on stderr (otherwise failures are silent — telemetry never blocks the pipeline).

## Recent releases

> **v2.34.0 released** — Minor. Two epics in one window. **KJC-PCS-0052 "Multi-language RAG"** — Python, Rust, Go and Java join JS/TS as first-class citizens of the local RAG index (AST chunkers via `web-tree-sitter` + multi-lang watcher + audit/onboarder multi-stack manifest sniffer), so a polyglot repo gets the same semantic retrieval surface as a single-language one. **KJC-PCS-0053 "RAG Quality & Observability"** — `kj rag eval` ships a frozen golden-query harness with `recall@k + MRR` (CI-gated via `--min-recall`), content-hash dedup skips redundant embeddings, optional MMR diversification returns *different* chunks instead of five near-duplicates, and `docs/RAG.md` gains a six-questions deep-dive documenting the system end-to-end. `kj rag index --since <ref>` + a post-merge git hook keep the index in sync with `git pull` / merge without manual intervention.
>
> - **`vec_store_meta` + `kj rag index --since`** (PR #882, KJC-TSK-0455 PR1): per-project last-indexed-commit stamp; `--since auto` resolves it; explicit refs honoured; missing baseline falls back to a full index with a friendly warning. Idempotent.
> - **Post-merge hook + pre-run drift check** (PR #883, KJC-TSK-0455 PR2): new `kj rag install-hooks` writes `.git/hooks/post-merge` so `git pull` auto-triggers a delta re-index. Pre-run drift check emits a one-line hint when `HEAD` is ahead of the last indexed SHA by more than N files.
> - **Language registry + Python canary** (PR #884, KJC-TSK-0474): new `src/lang/registry.js` with `adapterForPath(file)`; the indexer + watcher both route through it. Python lands as the first non-JS adapter to exercise the registry shape from day one.
> - **Python AST chunker** (PR #886, KJC-TSK-0478) and **Rust AST chunker** (PR #888, KJC-TSK-0479): web-tree-sitter walkers + regex fallbacks, grammars vendored under `vendor/tree-sitter-grammars/*.wasm` so SEA binaries stay self-contained.
> - **Indexer prepares Python / Rust grammars** (PR #889, KJC-TSK-0480): `prepareAdapters()` awaits the grammar loads before walking so the first file doesn't pay the cold-load tax mid-batch.
> - **Go AST chunker** (PR #890, KJC-TSK-0481): tree-sitter walker + regex fallback. Method receivers rendered explicitly so retrieval surfaces method-vs-function disambiguation without re-parsing.
> - **Multi-stack manifest sniffer for `basal-cost`** (PR #891, KJC-TSK-0476): `kj audit` now reads Python (`pyproject.toml`, `requirements*.txt`), Rust (`Cargo.toml`), Go (`go.mod`) and Java (`pom.xml`, `build.gradle*`) manifests alongside `package.json`. Cost estimates no longer assume JS/TS.
> - **Multi-stack frameworks in audit bundle** (PR #892, KJC-TSK-0477): the audit bundle JSON gains a `stacks` field listing detected language stacks + framework hints (Django, Flask, Actix, Tokio, Gin, Echo, Spring, Quarkus...). Onboarder + audit role render polyglot reality.
> - **Java AST chunker** (PR #893, KJC-TSK-0486): two-level walker (class / interface / enum / record → method / constructor) + regex fallback. Inner classes flattened with `Outer$Inner` symbols.
> - **`docs/RAG.md` six-questions deep-dive** (PR #894, KJC-TSK-0485): per-language chunker table, six-provider embedder matrix, hybrid + rerank + metadata filter, update strategy table, validation tiers. Excluded from the shrink-budget gate.
> - **Watcher derived from language registry** (PR #895, KJC-TSK-0482): `kj watch` matcher no longer hard-codes JS/TS. Python / Rust / Go / Java sources trigger live re-index.
> - **Content-hash skip-on-match** (PR #896, KJC-TSK-0484 PR-A): each chunk gains a `sha256` column; identical bodies skip the Ollama call. Re-indexing identical files now costs zero embeddings.
> - **MMR diversification in retriever** (PR #898, KJC-TSK-0484 PR-B): optional `rag.search.mmr` over the top-N candidates; lambda (`rag.search.mmrLambda`, default 0.5) trades pure cosine relevance for diversity. Off by default.
> - **Retrieval-quality harness** (PR #899, KJC-TSK-0483 PR-A): pure `runEval(queries, runQuery, { topK, ks })` scoring recall@k (binary) + MRR. `tests/rag/golden-queries.json` ships 20 entries covering the public surface of `src/rag/`.
> - **`kj rag eval` CLI + baseline docs** (PR #900, KJC-TSK-0483 PR-B): subcommand wires the harness to the indexed corpus, emits aggregate + per-query report (human or `--json`), and sets `process.exitCode = 1` when `--min-recall <n>` is set and aggregate falls below — drop-in CI gate after `kj rag index`.

> **v2.33.0 released** — Minor. **AI Harness Scorecard golden metric (KJC-PCS-0051, Plan B)** — every `kj audit` now boots a Docker one-shot of `addyosmani/ai-harness-scorecard`, gets a deterministic 0–100 score + A–F grade, persists it to a per-project `audit-history.db`, and on the next run renders the delta vs the previous baseline plus an optional Unicode-bar trend sparkline. One golden number for "how AI-friendly is this repo today vs last week," zero LLM tokens spent.
>
> - **Harness Docker one-shot** (PR #877, KJC-TSK-0470): `src/audit/harness-runner.js` runs `docker run --rm -v <repo>:/repo addyosmani/ai-harness-scorecard analyze`, parses the verdict, auto-skips on missing Docker. `--no-harness` opts out.
> - **`kj audit` integrates the score** (PR #878, KJC-TSK-0471): new harness-section renderer; JSON output gains `harnessScore`; runs during the deterministic phase so `--deterministic-only` users get it too.
> - **Per-project audit history** (PR #879, KJC-TSK-0472): `.karajan/audit-history.db` (better-sqlite3 + WAL + `PRAGMA user_version=1`) persists every run. SEA bundle stubbed (degrades gracefully); npm install unlocks history.
> - **Diff + trend sparkline** (PR #880, KJC-TSK-0473): `src/audit/audit-history-display.js` (pure module, safe in SEA) computes overall delta + per-category deltas + biggest improvement/regression + stale-baseline flag (>30 days). New `--trend` flag prints a `▁▂▃▄▅▆▇█` sparkline over the last N runs.
>
> **v2.32.0 released** — Minor. **AI Harness Scorecard hardening (KJC-PCS-0051)** — Plan A closes five FAILs from the external scorecard audit in one sprint: Prettier `--check`, Coverage v8 reports, Conventional Commits enforcement, nightly drift detection, and an unsafe-code lint policy. Plus two bug fixes shipped alongside.
>
> - **Prettier `--check` CI job** (PR #868, KJC-TSK-0464): new `format` job blocks PRs whose formatting drifts from `.prettierrc.json`. Scope narrow at first (`.github/workflows/`, root config); future PRs fold in more dirs under the shrink-budget cap.
> - **Coverage v8 + CI artifact** (PR #870, KJC-TSK-0465): `vitest.config.js` emits `text + html + lcov` via `@vitest/coverage-v8`. New `coverage` job uploads `coverage/` (14-day retention). Per-glob thresholds enforced when the user opts in; `src/mcp/handlers/**` floor ratcheted to `70/60` to lock the current state — follow-up tracked to climb back to 80/80.
> - **Conventional Commits on PR head** (PR #872, KJC-TSK-0466): `wagoid/commitlint-github-action@v6` checks every PR commit against `.commitlintrc.json`. CI-side enforcement on top of the pre-commit local hook — bypassing husky no longer escapes the gate.
> - **Nightly drift workflow** (PR #873, KJC-TSK-0467): new `.github/workflows/nightly.yml` runs the full CI suite every night at 04:17 UTC against `main`. Failures auto-file/update a tracking issue tagged `drift` via `actions/github-script@v8`, so a flaky dep or upstream regression surfaces within 24 h instead of on the next unrelated PR.
> - **`eslint-plugin-security` policy** (PR #874, KJC-TSK-0468): `eslint.config.js` now blocks `eval`, `new Function`, dynamic `require`, `pseudoRandomBytes` and `mustache`-escape disabling as hard errors; flags `detect-non-literal-regexp` as warn. Noisy members of the recommended preset are intentionally NOT enabled.
> - **42 tests on `main` repaired** (PR #869, KJC-BUG-0065) and **`await openEditor` race in spec-reviewer refine-loop fixed** (PR #871, KJC-BUG-0066). The hardening sprint sits on a clean `main` again.
>
> **v2.31.0 released** — Minor. **Team-shared HU Board** — the full KJC-PRP-0002: opt-in HUs into a `.karajan-shared/` cohort, the board surfaces them with a `shared` badge, and per-HU `assignee` lets multiple machines work the same plan without trampling each other.
>
> - **`kj plan share` / `kj plan unshare`** (PRs #860, #862): mueve plans entre `~/.karajan/plans/` (local) y `<projectDir>/.karajan-shared/plans/` (compartido). Idempotente. El loader probará ambos automáticamente.
> - **`share --only HU-001,HU-003` / `--exclude HU-005`** (PR #863): selective sharing — comparte solo lo que quieres, deja los WIP privados sin partir el plan.
> - **Board scanner + `shared` badge** (PRs #861, #862): el watcher recorre los dos roots, mete las HUs compartidas en la misma tabla con `is_shared = 1`, y el modal pinta un pill `shared` junto al título del plan.
> - **`sharedConflictPolicy` escape hatch** (PR #864): `prompt | local-wins | shared-wins` en kj.config.yml. Cuando dos máquinas editan la misma HU compartida, la política decide sin intervención. Log en `~/.karajan/board-conflicts.log`.
> - **Per-HU `assignee`** (PR #865): handle libre (`@manufosela`, `dev_016`, `becaria`…) por HU. Visible y editable en el modal **solo** en proyectos shared. Migración sqlite idempotente.
>
> **v2.30.0 released** — Minor. **Writable config UI on HU Board** — settings modal with grouped sections, atomic-write backend, and a global vs per-project scope toggle. No more hand-editing the YAML.
>
> - **Pipeline role toggles** (PR #854): 8 nuevos booleanos en el modal (`planner`, `researcher`, `architect`, `tester`, `security`, `refactorer`, `impeccable`, `brain`) reflejan los defaults reales de `src/config/defaults.js`.
> - **RAG controls** (PR #855): `rag.preload.{enabled,topK,scope}` + `rag.embedder.provider` editables sin abrir el archivo. El dropdown del provider lista los 6 embedders (ollama / openai / voyage / cohere / mistral / onnx).
> - **Grouped sections** (PR #856): los campos se agrupan por categoría (Agentes y modelos, Roles del pipeline, RAG, Tiempos de sesión, Calidad) con iconos y orden determinista. Campos nuevos sin categoría caen en "Otros" — defensivo.
> - **Scope toggle global vs per-project** (PR #857): pill toggle en el header del modal. Switchea entre `~/.karajan/kj.config.yml` (global, default) y `<projectDir>/.karajan/kj.config.yml` (override del proyecto, se crea al guardar). Atomic-write + `.bak` aplican a ambos.
>
> **v2.29.0 released** — Minor. **RAG quality lift** — dashboard + three new providers + metadata filter + rerank.
>
> - **Retrieval dashboard on HU Board** (PR #843): nuevo `/rag.html` con embedder activo, tamaño de DB, last-index, chunks por kind, chunks por proyecto. Primera pieza del config UI que llega completo en v2.30.
> - **Cohere + Mistral embedders** (PR #848): `embed-multilingual-v3.0` (multi-idioma) y `mistral-embed` (EU-hosted, útil para GDPR). `KJ_COHERE_KEY` / `KJ_MISTRAL_KEY` Karajan-scoped.
> - **ONNX local embedder** (PR #??): `@huggingface/transformers` corriendo en Node — sin Docker, sin API key, sin Ollama. Default `Xenova/all-MiniLM-L6-v2` (384 dim). Es la base para el zero-config init de v2.31.
> - **Metadata `--where` filter** (PR #??): `kj rag query 'auth' --where 'symbol=loadConfig AND kind=plan'`. Gramática mínima KEY=VALUE AND KEY=VALUE; cualquier metadata que emite el chunker es queryable sin schema changes.
> - **Cross-encoder rerank** (PR #??): opt-in `--rerank` re-ordena los topK con un cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`). Latencia acotada, calidad final notablemente mejor.
>
> **v2.28.0 released** — Minor. **RAG advanced** — live re-index + cloud embedders + hybrid scoring + AST chunker, plus a real fix for the v2.27.0 chapuza.
>
> - **`kj watch`** (PR #836): chokidar daemon que re-indexa los archivos del proyecto tras cada edit (1s debounce). Fin del `kj rag index` manual.
> - **OpenAI + Voyage embedders** (PR #841): para usuarios sin Docker local. `config.rag.embedder.provider: openai | voyage` + `KJ_OPENAI_KEY` / `KJ_VOYAGE_KEY` env vars (Karajan-scoped — preserva el architecture invariant).
> - **BM25 hybrid scoring** (PR #838): SQLite FTS5 + cosine fusion. `kj rag query --mode hybrid|semantic|keyword`. Queries con símbolos exactos rankean correctamente.
> - **AST source chunker** (PR #839): `@babel/parser`. Cada top-level declaration entera en un chunk; TypeScript + JSX + decorators soportados.
> - **KJC-BUG-0064** (PR #840): `parseCooldown` TZ-aware via `Intl.DateTimeFormat`. Deshace el skip-in-CI workaround de v2.27.0 — tests pasan en cualquier TZ.
>
> **v2.27.0 released** — Minor. **RAG polish** — three improvements triggered by the v2.26.0 smoke test on karajan-code itself:
>
> - **Per-project isolation** (PR #831): new `project_slug` column on chunks; `kj rag query --project <slug>` (auto-detected from cwd) filters the global DB. `--project all` to query across everything.
> - **`docs/RAG.md` + `docs/es/RAG.md`** (PR #832): single unified guide covering architecture, install, six workflows, configuration, limitations and troubleshooting. Replaces the documentation spread across CHANGELOG / templates / landing.
> - **Asymmetric source-vs-test ranking** (PR #833): NL queries like `how does X work` no longer rank `tests/X.test.js` above `src/X.js`; test-flavoured queries still surface tests.
> - Plus **KJC-BUG-0063** (PR #834): skipped a TZ-dependent test that was blocking every CI run, and a `shrink-budget` workflow exclude fix for `docs/*.md` at the root.
>
> **Coming in v2.30.0+**: writable config UI on the HU Board (toggle roles, switch coder/reviewer, adjust alpha/mode/rerank without re-editing the YAML), then v2.31 zero-config init (reduce the wizard to one critical question, smart defaults for everything).
>
> **v2.26.0 released** — Minor. **RAG Auto-Bootstrap** — Ollama runs in Docker out of the box. `kj init` now provisions the embedder automatically (or skips with a clear reason on modest hardware / `--no-ollama`); `kj doctor` surfaces health; `kj ollama [start|stop|status|pull]` manages lifecycle without docker compose. See [docs/RAG.md](docs/RAG.md) for the full RAG guide ([español](docs/es/RAG.md)).
>
> Capability check (RAM + Docker) means the bootstrap never breaks init: on Windows without Docker Desktop, on hosts under 4 GB free, or with `--no-ollama`, the wizard logs a one-liner and continues. Where Ollama is already running on `:11434`, `kj init` reuses the external instance instead of spawning a second container.
>
> Bundles **KJC-BUG-0061** fix (caught during v2.25.0 smoke test): `kj onboard --no-synth` was ignored by Commander shape mapping, `OnboarderRole.run()` was called without `init()`, and `kj rag query --json` on empty store emitted just `[]` instead of the `{empty: true}` contract the MCP handler returns.
>
> **Coming next from v2.26.0**: addressed in v2.27.0 above.
>
> **v2.25.0 released** — Minor. **RAG Camino B + Camino D** (KJC-PCS-0049). Closes the consumer-surface plan. Skills hosts can now invoke RAG via `/kj-rag-query` without MCP, and the pre-loop retrieval stage from v2.24.0 only fires when triage signals make it worthwhile.
>
> Camino B — `/kj-rag-query <text> [--scope <s>] [--top-k <n>]` slash command shipped by `kj init` to `.claude/commands/`. Thin wrapper over `kj rag query`; passes flags through, surfaces `empty:true` as a one-line hint, renders hits as background context rather than raw JSON. For Claude Code / Cursor instances loaded without MCP.
>
> Camino D — Brain decisor heuristic in `src/orchestrator/stages/rag-preload-decisor.js`. New `config.rag.preload.policy`: `always` (v2.24.0 behaviour, kept for back-compat), `never` (benchmarking), `auto` (default). In `auto` mode, retrieval fires when triage decomposes, level ∈ {complex, high, epic}, task body ≥ 200 chars, or `config.rag.preload.brownfield` is set. Otherwise the stage persists `{ skipped: true, reason: 'auto:low-value' }` and the pipeline pays no retrieval cost on trivial tasks.
>
> **Coming in v2.26.0+**: chokidar watcher for live re-indexing, AST source chunker (tree-sitter / `@babel/parser`), BM25 + cosine hybrid scoring.
>
> **v2.24.0 released** — Minor. **RAG Camino C — pre-loop auto-retrieval** (KJC-PCS-0049). After v2.23.0 taught the agents that `kj_rag_query` exists, Karajan now injects prior context for them automatically: a new pre-loop stage queries the vec store with the task description and prepends the top-K chunks to the task before any LLM call.
>
> Opt-in: `config.rag.preload.enabled = false` by default. Five guards before the retrieval fires (`disabled`, `no-task`, empty corpus, no hits, error). The stage never throws — best-effort enrichment, opt-out by default, opt-back-out on failure. When all guards pass, the task receives an extra block:
>
> ```markdown
> ## Prior context from RAG (auto-retrieved, top N)
>
> ### [plan · AUTH-1] /path/to/plan.json
>
> <chunk text, truncated 600 chars>
> ```
>
> Because `task` flows through `runPlanningPhases` to researcher / architect / planner via parameter passing, **one mutation feeds six consumers** — no per-stage prompt wrapper, no fan-out through `pipelineFlags`. Triage runs first because its `roleOverrides` gate the rest of the pipeline; the RAG stage runs right after, before `domainCurator`.
>
> Workflow:
>
> ```bash
> kj onboard
> kj rag index
> yq -i '.rag.preload.enabled = true' ~/.karajan/kj.config.yml
> kj run task.md  # researcher/architect/planner/coder all see prior context
> ```
>
> **Coming in v2.25.0+**: Camino B (`/kj-rag-query` slash command for Skills hosts), Camino D (Brain decisor heuristic deciding **when** to pre-fetch based on task complexity — refinement on top of C), chokidar watcher for live re-indexing, AST source chunker, BM25 + cosine hybrid scoring.
>
> **v2.23.0 released** — Minor. **RAG exposed to agents and humans alike** (KJC-PCS-0049, Steps 7+8+Camino A). After v2.22.0's CLI MVP, the corpus is now reachable from three more places.
>
> 1. **MCP tools** `kj_rag_query` + `kj_rag_index` (PR #815). Any MCP-connected agent — Claude Desktop, Cursor, Claude Code, Karajan's own roles — can call them. Tool count 25 → 27. Empty store responds `empty: true` so agents have a deterministic recovery signal.
> 2. **HU Board RAG panel** (PR #816). New input + scope dropdown (All / Plans / Onboarding / Code) + Search button + results pane between the preflight panel and the kanban. `POST /api/rag/query` backs it.
> 3. **Role templates teach agents about the tool** (PR #817). `templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md` each gain a tailored 'Prior context (RAG, opt-in)' section. Shared rule: when the store is empty, proceed without retrieval — do NOT block, do NOT ask the human to seed.
>
> Workflow:
>
> ```bash
> kj onboard
> kj rag index
> kj plan generate task.md --use-onboarding
> # From here on, every agent invocation can call kj_rag_query via MCP.
> # Humans get the panel on the Board.
> ```
>
> **Coming in v2.24.0+**: Camino B (`/kj-rag-query` slash command for hosts in Skills mode without MCP), Camino C (automatic pre-loop stage that pre-fetches retrieval and prepends it to the coder/researcher/architect prompt without the agent having to ask), Camino D (Brain decisor heuristic for when retrieval is worth the tokens), chokidar watcher for live re-indexing, AST-aware source chunker, BM25 + cosine hybrid scoring.
>
> **v2.22.0 released** — Minor. **Project RAG MVP** (KJC-PCS-0049). Karajan now indexes its plans + onboarding briefs (and optionally project sources) into a local vector store and lets you query them semantically from the CLI. Six PRs.
>
> | Step | PR | Module |
> |---|---|---|
> | 1 | #808 | Vector store on `better-sqlite3` + `sqlite-vec` at `~/.karajan/rag.db` |
> | 2 | #809 | Ollama embedder adapter (`nomic-embed-text`, dim 768, `localhost:11434`) |
> | 3 | #810 | Three chunkers: markdown heading hierarchy, plan JSON per-HU, JS/TS export-symbol |
> | 4 | #811 | Indexer (`indexFile` + `indexProject`), idempotent, embedder failures = warn + continue |
> | 5 | #812 | Retriever + ranking, kind boost breaks ties (plan +0.05, onboarding +0.03, code 0) |
> | 6 | #813 | `kj rag` CLI: `index [--with-sources]` + `query <text> [--scope] [--top-k]` |
>
> ```bash
> cd ~/your-project
> kj onboard                       # Architecture Brief
> kj plan generate task.md -y      # Plans
> kj rag index                     # Seed the vec store
> kj rag query "how did I handle auth in module X?"
> ```
>
> **Coming in v2.23.0**: MCP tool `kj_rag_query` (other agents query the RAG), HU Board search panel, chokidar watcher for live re-indexing, AST-aware source chunker, BM25 + cosine hybrid scoring.
>
> The SEA binary stubs out `src/rag/*` + `src/commands/rag.js` (same pattern as the HU Board) — `kj rag` requires `npm install -g karajan-code`.
>
> **v2.21.0 released** — Minor. **Brownfield Onboarder role**. Karajan now ships a dedicated path to analyze any existing codebase and produce a Markdown Architecture Brief that the planner can consume as automatic context. Closes KJC-TSK-0384 (3 PRs).
>
> KJC-TSK-0384 (PRs #804 + #805 + #806): **`kj onboard`** runs five deterministic collectors over a project root — directory walk (ignoring `node_modules` / `.git` / `dist` / `build`), git log (commits, branches, hot files via `--name-only` over the last 200 commits), 18 well-known config patterns + `package.json` scripts, ADR-style filenames under `docs/adr/`, `docs/adrs/`, `docs/architecture/`, plus a one-shot bundle. Then optionally synthesises a Markdown Architecture Brief via the new OnboarderRole. Output lands at `~/.karajan/onboarding/<slug>.md`. Flags: `--no-synth` (skip the LLM call, dump the raw collectors — useful for CI), `--output <path>` (override default target). Greenfield projects produce `# Project is greenfield` instead of erroring.
>
> **New `--use-onboarding` flag on `kj plan generate`**: reads the cached Architecture Brief and prepends it to the planner context under a `## Architecture Brief (from kj onboard)` heading. Silent on cache miss without the flag; loud `warn` when the flag is set but no cache exists, so a missed `kj onboard` invocation surfaces immediately.
>
> Workflow:
>
> ```bash
> kj onboard                            # produces ~/.karajan/onboarding/<slug>.md once
> kj plan generate task.md \
>     --use-onboarding                  # next plan uses it as context
> ```
>
> **What's next** — The **Project RAG** epic (KJC-PCS-0049) starts in v2.22.0: vector store + Ollama embedder + indexer + retriever + CLI / MCP / HU Board consumers. Onboarder is its prerequisite (the brief feeds the indexer's first pass).
>
> **v2.20.0 released** — Minor. **HU Board polish + UX papercuts** cluster: 5 cards closed across two net-new features, two PG housekeeping syncs for work that had already landed, and one docs refresh.
>
> KJC-TSK-0397 (PR #801): **`kj plan generate` now prepends a `[PREFLIGHT-000]` HU to every plan** and gates every functional HU on it. The HU's acceptance tests are stack-aware shell commands — Node gets `node --version` + `npm install` + conditional `npm test` / `npm run lint`; Python gets `python --version` + `pip install -r requirements.txt` (or `poetry install`) + `pytest --collect-only`; Firebase projects get `firebase projects:list`; GCP projects get `gcloud auth list`; everyone gets `git status --porcelain`. Idempotent: a plan that already has a HU titled `PREFLIGHT-000` / "verificar entorno" is left untouched. Opt out per-invocation with `--no-preflight-hu`. The point: Karajan owns the plumbing, the user no longer has to remember to add a 'verify env' step to every task file.
>
> KJC-TSK-0395 (PR #802): **`kj init` learns a config scope wizard plus `--global` / `--local` flags**. The wizard now asks where the config should land — `~/.karajan/kj.config.yml` (global) or `./.karajan/kj.config.yml` (local override). `loadConfig` refuses to load a project that has a local config without a global counterpart with an actionable message — the override-on-top-of-base invariant. Use case: a repo with `coder=claude`, another with `coder=opencode`, without editing YAML by hand.
>
> KJC-TSK-0396 (PG sync, originally PRs #702 + #703): **HU Board `⏹ Stop` button** aborts every `kj run` associated with a plan via SIGTERM → SIGKILL escalation, resets running HUs to pending. Already shipped in v2.10.x; today's release closes the PG card with the canonical commits as evidence.
>
> KJC-TSK-0377 (PG sync, originally PR #683): **auto-cleanup ampliado** to also catch `s_*`, `plan-*`, `auto-tmp_*`, `auto-test_*` prefixes during the boot ephemeral-project sweep. Already shipped in v2.12.x.
>
> KJC-TSK-0385 (PR #800): **`docs/task-templates/spec-conventions.md` gains Section 8 (`spec_section` REQUIRED when numbered SPEC headings present) and Section 9 (`acceptance_tests` shape, 2-4 tests, gherkin + shell mix)**. Plus `plan-generate.md` switches two stale `~/.kj/plans/` paths to `~/.karajan/plans/`.
>
> **v2.19.4 released** — Patch. **`kj resume` now continues from where it stopped** + **autoInit no longer commits zombies on the user's main**. Two bugs closed in one release.
>
> KJC-BUG-0058 (PR #798, reported by [@aitormf](https://github.com/aitormf)): a session that stopped during Sonar would re-run the full pre-loop on `kj resume <id>` — HU-reviewer, intent, discover, triage, domainCurator, **researcher, architect, planner** all from scratch — doubling token cost and breaking the value-prop of the command. Root cause: `resumeFlow` (flow-runner.js:280) called `runFlow` without rehydrating stage state, and the session never persisted stage outputs in the first place. **Fix**: two new mutators in `src/session/mutators.js` (`setStageResult` mirrors into `stage_results[name]` + `stages_completed[]`; `setStageBundle` adds `stage_bundles[name]` for cross-stage context like `researchContext`, `architectContext`, `plannedTask`). Two closures inside `runPreLoopStages` (`persistStage` + `resumeSkip`) wrap every cacheable stage. `init-context.js` rehydrates `ctx.stageResults` from the loaded session before invoking the pre-loop. Triage is *not* skipped on resume — it produces `roleOverrides` the Brain decisor depends on and is cheap to re-run.
>
> KJC-BUG-0060 (PR #797, reported by @manufosela during the v2.19.3 release): `git checkout main` reported `[ahead 27]` of origin/main. Every commit was titled `initial commit`, authored by the local git identity, and had the **exact same tree as its parent** — completely empty. The reflog held **2 495 such SHAs** accumulated since April 2026. None ever reached origin/main (gh push / CI would have rejected them) so runtime impact was zero, but the local history was noisy and on every release it looked like a sync loss. Root cause: `src/orchestrator/config-init.js::autoInit()` guarded with `!(await exists(projectDir/.git))`, which fails two ways: (a) dogfooding kj on karajan-code itself from a subdir → `exists()` returns false → `git init` re-initializes the *parent's* `.git/` (idempotent, harmless) → `git commit --allow-empty` then resolves upward and lands an empty commit on the parent's main; (b) transient FS hicks (EACCES/ENOENT) flip `exists()` to a false negative. **Fix**: switch the static FS probe for `git rev-parse --is-inside-work-tree`, which performs the same upward search git would use for the commit itself — guard cannot disagree with the operation it guards. And drop the `git commit --allow-empty -m "initial commit"` step entirely: no downstream stage needs a root commit; the 2 495 zombies never broke anything, the seed was decorative and turned out to be the actual user-visible symptom.
>
> **If your `kj resume` re-runs researcher/architect, or your `git status` shows mysterious `[ahead N]` after dogfooding kj on a kj-linked source tree, upgrade to v2.19.4.**
>
> **v2.19.3 released** — Patch. **HU Board now reads + writes plans from the canonical home dir** (KJC-BUG-0059). Reported by [@aitormf](https://github.com/aitormf): the top card showed `Directorio del proyecto — no detectado` even when the run had a valid `projectDir` and the coder was reading files from it. Root cause: five board call sites still hard-coded `~/.kj/plans/` as their plans root — leftover from the v2.19.0 home consolidation, which fixed `sync.js` but missed the rest. After the auto-migrator ran (or the user created new plans post-v2.19.0), plans landed under `~/.karajan/plans/<slug>/`; the board kept looking under `~/.kj/plans/<slug>/` and silently found nothing — so `GET /api/projects/:id/preflight` could not extract `projectDir` (the literal Aitor saw), `GET /api/projects/:id/plans-outcome` returned `plans: []` for every project, `DELETE /api/projects/:id` swept the wrong path leaving residue on disk, `DELETE /api/plans/:planId` failed silently, `plan-mutations.plansRoot` wrote new per-HU run logs to the legacy root splitting state across both, and `cleanup-zombies` never GC'd zombies under `~/.karajan/plans/`. PR #795 ships three new exports in `packages/hu-board/src/db.js`: `getHuBoardPlansDir()` (canonical, or `KJ_PLANS_DIR` override), `getHuBoardLegacyPlansDir()` (legacy, null when override set), `getHuBoardPlansDirs()` ordered `[canonical, legacy?]` for read callers. Single-write callers (`plan-mutations`) use the canonical root; read / delete / GC iterate both so users mid-migration with plans still under `~/.kj/` don't regress. 29 hu-board test files / 349 tests still green. **If your board shows "Directorio del proyecto — no detectado" on a project that clearly works in CLI, upgrade to v2.19.3.**
>
> **v2.19.2 released** — Patch. **SonarQube 401 now triggers automatic token re-bootstrap** instead of failing the run (KJC-BUG-0057). Until v2.19.1, when the Sonar token was missing / stale / revoked / pointed at a recreated Sonar instance, `kj run` / `kj audit` threw `SonarQube authentication failed (HTTP 401)` with the hint "Regenerate with `kj init`" — putting the user in the loop for plumbing Karajan can do itself. PR #793 wires `src/sonar/api.js::sonarFetchOnce` to invoke a new `src/sonar/token-recovery.js::recoverSonarToken()` on the first 401, which reuses `bootstrapSonarToken()` (already shipped in v2.10.2) — probes admin/admin, rotates the default password if still in place, revokes the existing `karajan-cli` token, generates a fresh GLOBAL_ANALYSIS_TOKEN, mutates `config.sonarqube.token` in place AND mirrors it to `~/.karajan/sonar-credentials.json` so future processes pick it up via the normal resolver chain instead of triggering recovery again. The original request retries once with the new token; the user never sees the 401 when recovery succeeds. Per-process latch ensures N endpoints 401-ing trigger ONE bootstrap, not N. Programmatic, **zero LLM involvement** — exactly the kind of plumbing Karajan should never delegate to the agent. Reported by [@aitormf](https://github.com/aitormf).
>
> **v2.19.1 released** — Patch. **APPLICATION BLOCKER fix** for the HU Board: every fresh `npm install -g karajan-code` since the HU Board feature shipped was producing tarballs without the `packages/hu-board/` directory (the `files` array in `package.json` did not include it), and even when the user copied that directory manually, the board crashed at startup with `Cannot find package 'helmet' imported from .../packages/hu-board/src/server.js` because its five dependencies (`helmet`, `chokidar`, `better-sqlite3`, `express`, `express-rate-limit`) were declared in `packages/hu-board/package.json` but missing from the root `dependencies`. PR #791 adds `packages/hu-board/{src,public,package.json}` to `files`, adds the five deps at root at the exact same versions so `npm dedupe` collapses to one copy resolvable by upward traversal, and regenerates `package-lock.json`. Verified end-to-end: `npm pack --dry-run` now ships 12 board files; `node packages/hu-board/src/server.js` boots cleanly. Also internal: 38 direct `os.homedir()` callers routed through the unified resolver (PR #790, `KARAJAN_HOME` now redirects every component) and 5 inline constructions of `~/.karajan/hu-board-runs/` unified under one helper (PR #789). Reported by [@aitormf](https://github.com/aitormf). **If you tried v2.19.0 and `kj board start` failed, upgrade to v2.19.1.**
>
> **v2.19.0 released** — Minor. Consolidates the HOME-level state of Karajan into a single root: **`~/.karajan/`**. Previously `~/.kj/` held plans, hibernated standby state, run-registry entries and worktrees, while `~/.karajan/` held sessions, hu-stories, config and the rest — no ADR justified the split and four divergent `getKjHome()` implementations had drifted. Three internal PRs land the change without breaking anyone: PR #781 unifies the resolver and introduces **`KARAJAN_HOME`** as the canonical env var (with `KJ_HOME` honoured + one-shot deprecation warning); PR #782 ships an idempotent **auto-migrator** that runs once on the next `kj` invocation — tarball backup at `~/.karajan/backup/kj-pre-migration-<ISO>.tar.gz` BEFORE moving, marker file `~/.karajan/.kj-migrated.json` prevents re-runs, cross-device safe (`rename` → `cp + rm` on `EXDEV`); PR #783 flips every default to `~/.karajan/` and adds a `legacy-kj-home` check to `kj doctor`. The HU Board reads BOTH locations until the migrator fires, so users who start the board first never see "missing plans". Restore is one `tar -xzf ~/.karajan/backup/kj-pre-migration-<ts>.tar.gz -C ~` away. Safe upgrade from 2.18.x.
>
> **v2.18.1 released** — Patch. Six user-feedback follow-ups to v2.18.0: **`kj-tail` after `kj resume`** (#772, was silent because `resume.js` skipped `withCliRunLog`); **standby waits in-process instead of exiting on a short cooldown** (#773, kj stays alive for waits ≤ 12 h and retries on its own; Ctrl+C during the wait prints `kj standby resume <id>`); **closed KJC-BUG-0040 — SEA linux binaries** (#774, was a race between `gh release create` and softprops, not `better-sqlite3` as the memory said — 60 s poll fix + `make_latest:false`); **stack bias — Python repos no longer get vitest** (#775 + #776 + #777, `detectProjectStack` finally cabled into the coder prompt, the HU auto-generator templates by language, and the synthesizer + `auto-hu-batch` take the stack from the filesystem). 4 971/4 971 tests passing across 416 files. Safe upgrade from 2.18.0.
>
> **v2.18.0** — Minor. Closes the **resilience audit** triggered by the public launch: 15 PRs across 5 phases hardening Karajan against the silent-failure family of bugs — *the problem is not that something fails, the problem is failing without telling the user why.* **Phase 1 — hibernation end to end** (#756–#759): a quota cap is classified as a recoverable quota class (incl. Claude Code's `"You've hit your session limit · resets 10:10pm"`); `withBrainRecovery` persists a standby JSON; the orchestrator consumes `action:"hibernate"`, seals the session `hibernated` (resumable) instead of `failed`; the last line printed is the exact resume command (`kj standby resume <id>`). **Phase 2 — don't lie** (#761–#763): `runCommand` surfaces ENOENT so a missing agent CLI gets an actionable error (not an empty one); `silenceTimeoutMs` is forwarded to every role so a hung agent is killed, not waited on forever; all 6 state-file writers go through `writeJsonAtomic` (write-temp + rename) — interrupted writes can no longer truncate plans, sessions, standby snapshots. **Phase 3 — don't lose or block** (#764–#767): a corrupt plan JSON is renamed aside with a loud warn (was silently dropped from `kj plan list`); `kj.config.yml` parse errors throw `Invalid YAML in <path>` (used to brick every kj command including `kj doctor`); `injectLoadedPlan` reconciles HUs left in `coding`/`reviewing`/`running` by a killed `kj run` (cross-checked against the run-registry); board SQLite gets `busy_timeout`, a `user_version` schema gate and corruption recovery. **Phase 4 — don't degrade silently** (#768–#769): `TriageRole` warns loudly when LLM output is unparseable (used to skip researcher/architect/security/tester with a chirpy "fallback defaults" summary); `verifyCoderOutput` distinguishes a git failure from "the coder did nothing" (`gitError` + `retryStrategy: null`) — no more iterations blaming the agent for infra. **Phase 5 — safety net** (#770): a `tests/resilience/` suite indexes every silent-failure mode and pins each one with a test, plus an end-to-end tripwire for the whole quota → hibernate → resume flow. Plus CI runs the `packages/hu-board` suite on every PR (#755). 4 959/4 959 tests passing across 416 files. Safe upgrade from 2.17.2.
>
> **v2.17.2** — Patch. Wires quota-exhaustion **hibernation end to end**. A `kj run` / `kj plan` that hits a provider session or usage cap used to abort the task with an opaque `UNKNOWN_FATAL`; now it suspends and tells you how to resume. **Session-limit classification (#756)**: `"You've hit your session limit · resets 10:10pm"` matched no rate-limit pattern → `session limit`/`weekly limit` added, and `parseCooldown` learns the 12-hour `resets 10:10pm` clock. **Hibernation persists (#757)**: `withBrainRecovery` only wrote `~/.kj/standby/<id>.json` with a `sessionState`, which no caller passed — new `buildStandbyState()` assembles it with an allowlisted env subset (never the full `process.env`). **Orchestrator consumes `action:"hibernate"` (#758)**: no code checked for it, so a hibernation sealed the HU `failed`; the coder/refactorer stages now stop cleanly and the session is sealed `hibernated` (resumable). **Resume hint (#759)**: a stopped run's last line is now the exact command — `kj standby resume <id>` for a hibernation, `kj resume <id>` otherwise. Plus CI now runs the `packages/hu-board` suite (#755). 4 931/4 931 tests passing across 410 files. Safe upgrade from 2.17.1.
>
> **v2.17.1** — Patch. Fixes **KJC-BUG-0055**: a project deleted from the HU Board (🗑️) no longer resurrects on the next `kj plan` or board restart. Four independent leaks closed: (1) **`sync.js` temporal gate** — the unconditional `removeTombstone` from KJC-BUG-0050 becomes a `plan.updatedAt > tombstone.deleted_at` comparison, so a tombstoned project revives only when the plan is genuinely newer than the delete; (2) **`ephemeral-cleaner.js`** now writes a tombstone and `rm -rf`'s `hu-stories/`, `sessions/` and `~/.kj/plans/` dirs when wiping ephemeral projects at boot — previously the orphan directories revived the project on the next scan; (3) **`fullScan` boot GC** sweeps orphan tombstoned dirs (the manual DB-wipe case); (4) **`DELETE /api/projects/:id`** honours `KJ_PLANS_DIR` instead of the hardcoded path. New `getTombstone()` helper in `db.js`. **Also fixes a silent `kj board start` failure (#753)**: the daemon's entry-point guard compared `import.meta.url` to a hand-built `file://` path, which wrongly returned false on Windows, symlinked/global installs and paths with spaces — the board exited 0 with an empty log. `server.js` now trusts a `KJ_BOARD_DAEMON` launcher flag, adds `uncaughtException`/`unhandledRejection` handlers and an actionable `better-sqlite3` load error; `board.js` detects an early daemon exit instead of reporting a phantom PID. 4 909/4 909 tests passing across 408 files. Safe upgrade from 2.17.0.
>
> **v2.17.0** — Minor. `kj audit` gains two new deterministic structural collectors and the v2.16 Sonar false-positive filter is generalised to apply across every collector. **Knip dead-exports collector** (codeQuality dim): reports unused exports/types (MINOR) and unused files (MAJOR), stack-aware (JS/TS only, needs package.json), subprocess via `--reporter json`, 120s timeout. **Madge circular-import collector** (architecture dim): detects import cycles, severity by chain length (≥4 files = MAJOR), honours tsconfig.json path aliases, 60s timeout. **Generalised FP filter**: every collector (sonar, knip, madge, osv, semgrep) now uses the same `config.audit.false_positives` shape with `tool` field plus inline marker `// karajan-audit-ignore: <tool>:<ruleId>`; legacy `config.sonar.false_positives` and `// karajan-sonar-ignore:` keep working. **Built-in catalogue** ships 4 entries by default (knip:unused-files in tests/fixtures + examples, knip:unused-exports on barrel files, madge cycles in node_modules). **BREAKING(engines)**: Node `>=20.10` → `>=20.19` (knip 6.x requirement; same flavour as the v2.8 18→20.10 bump). 4 872/4 872 tests passing across 402 files. Safe upgrade from 2.16.0 if you're on Node ≥ 20.19.
>
> **v2.16.0** — Minor. Quality-focused release: **deterministic Sonar false-positive filter** (KJC-TSK-0416), wire universal de Brain Recovery completado en `semantic-detector` (TSK-0413 step D), codemod `replace(/regex/g, …)` → `replaceAll(/regex/g, …)` en 41 sitios, y limpieza de hallazgos del propio `kj audit` v2.15.0. The Sonar filter combines two mechanisms: (1) **static rules** `{ rule, filePattern, reason }` from a built-in catalog (covering common false positives like `javascript:S2699` on `tests/architecture/`) plus extensible via `config.sonar.false_positives`; (2) **inline ignores** with `// karajan-sonar-ignore: <ruleId>` on the issue line. Result: the coder stops burning tokens "fixing" non-broken assertions. Brain Recovery now wraps **every** AI call in the pipeline — `semantic-detector` was the last legacy caller. 4 846/4 846 tests passing across 401 files. Safe upgrade from 2.15.0.
>
> **v2.15.0** — Minor. Three epics, 30+ commits, ~4 000 LOC. (1) **Brain Recovery** (KJC-PCS-0044): universal error classifier with 7 rich classes (rate_limit_short, quota_daily, quota_monthly, api_down, auth_failed, network_timeout, silenced, unknown_fatal), `withBrainRecovery` wrapper wired into ALL agent invocations (no silent failures), persistent hibernation in `~/.kj/standby/<id>.json` with event-driven scheduler (no polling), `kj standby list` + `kj standby resume`, board reconcile at startup, **fallback chain** when quota exhausted with `retryAfter > 12h` (Claude → Codex → OpenCode → Aider, configurable per role via `kj init`). (2) **Model Routing + Undo** (KJC-PCS-0043): each HU gets `coder_model` + `reviewer_model` with cross-provider review by default (claude↔codex), per-HU override from board modal, OpenCode + Aider as first-class providers, ⏪ Undo button restores files via git snapshots. (3) **Self-Healing Plan** (KJC-PCS-0042): structural integrity pass breaks cycles + cleans orphan refs, smart convergence guard for self-fix loop, `kj plan fix [planId] [--prompt]` for iterating without regenerating, skip Sonar for SPIKE/DOC/RESEARCH HUs, eliminate Failed kanban column. 4 835/4 835 tests passing across 400 files. Safe upgrade from 2.14.3.
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

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

## Links

- [Website](https://karajancode.com) (also [kj-code.com](https://kj-code.com))
- [Full documentation](https://karajancode.com/docs/)
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [License (AGPL-3.0)](LICENSE)

---

Built by [@manufosela](https://github.com/manufosela). Engineering Lead, co-organizer of NodeJS Madrid, author of [Liderazgo Afectivo](https://www.liderazgoafectivo.com). 100+ npm packages published.

### Contributors

- [@aitormf](https://github.com/aitormf) — OpenCode agent (5th built-in agent), early-bug reporter on resume/standby flow
- [@jorgecasar](https://github.com/jorgecasar) — Model registry, display refactor, valibot config proposals; multiple issue triages
- [@reiaguilera](https://github.com/reiaguilera) — Beta testing, feature proposals, and quality feedback
