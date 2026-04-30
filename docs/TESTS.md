# Karajan Code — Test Suite Overview

> **Snapshot as of v2.8.0**: 4 199 tests across 357 files (+7 e2e in PR #570 closing the FASE 1 spec). All green on Node 20.x and 22.x. CI matrix dropped Node 18 in v2.8.0 (engines.node bumped to >=20.10.0; Node 18 LTS hit EOL on 2025-04-30) — see `.github/workflows/ci.yml`.

This document explains **what each test directory tests, why it exists, and how to read its failures**. Karajan's test suite is the gate that keeps the orchestrator's contracts intact across releases. If you're touching anything under `src/`, find the matching directory below first.

## How to run

```bash
# Full suite
npm test

# Single file (fast iteration)
npx vitest run tests/skills/addyosmani-catalog.test.js

# Single test (filter by describe/it text)
npx vitest run -t "addyosmani"

# Watch mode while developing
npx vitest

# Lint (syntax-only, runs `node --check` per file)
npm run lint

# Lint + tests
npm run validate
```

Vitest config (`vitest.config.js`): excludes `node_modules`, `packages` (the hu-board sub-package has its own vitest), `.claude`, `.kj`, `demo`. Setup file `tests/setup.js` defaults a few global flags so the orchestrator tests don't hit external services:

| Global | Default in tests | Purpose |
|--------|------------------|---------|
| `__KJ_DEFAULT_PREFLIGHT_EXTENDED` | `false` | Skip extended preflight (port, dirs, tokens, MCP, skills) so orchestrator tests don't poll real ports |
| `__KJ_DEFAULT_SKILLS_MODE` | `"regex"` | Skip semantic skill classifier so tests don't spawn LLM calls |
| `__KJ_DEFAULT_BRAIN_DECISOR` | `false` | Brain off by default; tests opt in per case |
| `__KJ_DEFAULT_ADDYOSMANI_ENABLED` | `false` | Don't `git clone addyosmani/agent-skills` from the test runner |

API key env vars (`ANTHROPIC_API_KEY`, etc.) are pre-set to dummy `sk-test-*` values so token-presence checks pass.

## Directory map

```
tests/
├── architecture/         # ⚠️  Invariants — fail loud if Karajan's contract changes
├── brain/                # Karajan Brain (orchestrator AI) + Solomon (judge AI)
├── budget/               # Cost & token accounting
├── checks/               # Preflight environment checks (Node, ports, dirs, CLI)
├── display/              # Terminal output / colour / formatting
├── e2e/                  # End-to-end smoke (currently empty — replaced by command-* and orchestrator-*)
├── fixtures/             # Shared test data (no tests, just .json/.md inputs)
├── guards/               # Deterministic pre/post-agent guards (intent, output, perf)
├── hu/                   # HU (User Story) decomposition & auto-generation
├── infrastructure/       # DI adapters (FileSystemService, CommandRunner, mocks)
├── orchestrator/         # Pipeline core — flow-runner, stage-executor, hu-board autostart
├── prompts/              # Prompt-template builders per role
├── roles/                # Each role's behaviour (coder, reviewer, tester, etc.)
├── agents/               # Each provider agent (claude, codex, gemini, aider, opencode)
├── session/              # Journal — decisions.md, summary.md, iterations.md, tree.txt
├── skills/               # OpenSkills + addyosmani/agent-skills providers
├── support/              # Shared test utilities (opt-in helper, mocks)
├── types/                # JSDoc typedef sanity
├── utils/                # task-file, cli-run-log, budget, project-detect
├── setup.js              # Global vitest setup (env vars + globals)
└── *.test.js             # ~230 top-level tests (cross-cutting: full pipeline, smoke, integration)
```

## Coverage map across the pipeline

```
                    ┌─────────────────────────────────────────────────┐
                    │  USER LAYER  (CLI + MCP)                        │
                    │                                                 │
   tests/utils/     │  task-file, cli-run-log, project-detect         │
   tests/checks/    │  preflight (node, ports, dirs, mcp-health, cli) │
   tests/architecture/  ←  no-provider-apis (invariant)               │
                    └─────────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────────────┐
                    │  ORCHESTRATOR  (flow-runner.js)                 │
                    │                                                 │
   tests/orchestrator/  hu-board-autostart, stage-executor            │
   tests/brain/         decisor, solomon-consult, integration         │
   tests/guards/        intent, output                                │
   tests/skills/        addyosmani, openskills, role-filter, semantic │
                    └─────────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────────────┐
                    │  ROLES                                          │
                    │                                                 │
   tests/roles/         coder, reviewer, tester, security, ...        │
   tests/prompts/       per-role prompt builders                      │
   tests/hu/            HU decomposition, auto-generator              │
                    └─────────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────────────┐
                    │  AGENTS  (subprocess wrappers — claude, codex…) │
                    │                                                 │
   tests/agents/        base, create, claude, codex, gemini, aider,   │
                        opencode, agent-di                            │
   tests/infrastructure/ FileSystemService, CommandRunner mocks       │
                    └─────────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────────────┐
                    │  SESSION & OUTPUT                               │
                    │                                                 │
   tests/session/       summary-writer, decisions-writer,             │
                        iteration-logger, tree-writer                 │
   tests/budget/        cost & token accounting                       │
   tests/display/       terminal formatting                           │
                    └─────────────────────────────────────────────────┘
```

---

## What each directory tests

### `tests/architecture/` — Invariant guards

> Fail-loud regression tests for **architectural rules that must never silently change**. Touch only after a deliberate discussion.

| File | Asserts |
|------|---------|
| `no-provider-apis.test.js` | Karajan does NOT use provider SDKs. Scans `package.json` (deps + devDeps) and every file under `src/` for `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, etc. Also forbids `process.env.ANTHROPIC_API_KEY` reads outside the preflight allowlist. Forces every provider check to be `cli:<provider>`, never `token:<provider>` (the only legitimate `token:` is `token:gh`). |

**Why**: Karajan is a CLI orchestrator, not an API client. Pre-v2.7.4 a misleading env-var preflight blocked legitimate runs because someone confused "the user has the env var" with "Karajan needs it". This file makes the contract enforceable in CI.

---

### `tests/brain/` — Brain (decisor) + Solomon (judge)

| File | Asserts |
|------|---------|
| `decisor.test.js` | Brain's intent-driven routing — given a task + stage results, it decides which role to invoke next, when to stop iterating, when to consult Solomon. |
| `decision-tracker.test.js` | Brain's per-iteration decision log (what was decided + why). |
| `solomon-consult.test.js` | Solomon's response shape (continue / stop / pause / ask-user) and side-effects (recordSolomonRuling). |
| `integration.test.js` | End-to-end: Brain receives a stage result → consults Solomon on a dilemma → applies the ruling. |

---

### `tests/budget/` — Cost & token accounting

| File | Asserts |
|------|---------|
| `budget.test.js` | Per-role cost/token tracking, threshold warnings, "with KJ vs without KJ" projection (KJC-TSK-0274). |

There's also `tests/utils/budget.test.js` with finer-grained unit tests of the math helpers.

---

### `tests/checks/` — Preflight environment

| File | Asserts |
|------|---------|
| `node.test.js` | `MIN_NODE_MAJOR = 18`. Node 18.20.4 → OK, Node 16.20.0 → FAIL with `nvm install` hint. |
| `ports.test.js` | Sonar / HU Board port detection. Distinguishes "Karajan-managed Sonar" (docker) from a foreign occupant. HU Board auto-rebinds to next free port. |
| `dir-setup.test.js` | `~/.karajan/{sessions,skills-cache,agent-skills,docker}` created on demand; remediation fails cleanly if the FS is read-only. |
| `tokens.test.js` | **CLI availability per active provider** (post-v2.7.4 contract — no env vars). `cli:anthropic` → `claude` binary, `cli:openai` → `codex`, etc. Plus the legitimate `token:gh` for `git push`. |
| `mcp-health.test.js` | `karajan-mcp` and `serena` (when enabled) respond to MCP `initialize`. |
| `skills.test.js` | `npx openskills` availability. |
| `runner.test.js` | The orchestration that runs all the above checks in sequence, with auto-remediation passes. |
| `auto-remediation-e2e.test.js` | Full end-to-end of detect → remediate → re-verify, per check (port rebind, dir create, sonar autostart). |

---

### `tests/display/` — Terminal output

| File | Asserts |
|------|---------|
| `pipeline-tracker.test.js` (top-level) + `tests/display/` | Live terminal display: stage status, iteration markers, colour codes. |

---

### `tests/guards/` — Deterministic pre/post-agent guards

| File | Asserts |
|------|---------|
| `intent.test.js` | Pre-coder intent guard: blocks the coder when its plan diverges from the requested task. |
| `output.test.js` | Post-coder output guard: blocks destructive patterns (e.g., `rm -rf`, mass deletions, secret leaks) regardless of the coder's intent. |

---

### `tests/hu/` — HU (User Story) decomposition

| File | Asserts |
|------|---------|
| `auto-generator.test.js` | Triage's `decomposed:true` → atomic HUs with acceptance tests. |
| `parser.test.js` | YAML HU file parsing for `--hu-file <path>`. |
| `huReviewer.test.js` | HU certification before coder runs (each HU validated for atomicity / scope). |

---

### `tests/infrastructure/` — Dependency injection

| File | Asserts |
|------|---------|
| `mocks.test.js` | `MockFileSystem` and `MockCommandRunner` behave like the real ones from the agent's perspective (so swapping them in tests is safe). |
| `services.test.js` | The real `FileSystemService` and `CommandRunner` adapters — the prod path (KJC-TSK-0316). |

---

### `tests/orchestrator/` — Pipeline core

| File | Asserts |
|------|---------|
| `stage-executor.test.js` | The `StageExecutor` contract (`canRun` / `execute` / `onFailure`) and `StageRegistry`. |
| `hu-board-autostart.test.js` | HU Board fires up automatically when an HU batch is generated, picks a free port if 4000 is taken. |

The bulk of orchestrator coverage lives in the top-level `tests/*.test.js` (see below).

---

### `tests/prompts/` — Prompt templates

| File | Asserts |
|------|---------|
| `coder.test.js` | Coder prompt assembly: task + rules + methodology + skills section. |
| `audit.test.js` | Audit prompt with selectable dimensions. |

There are more top-level prompt tests (`tests/prompt-*.test.js`).

---

### `tests/roles/` — Role behaviours

| File | Asserts |
|------|---------|
| `coder-role.test.js` | Coder run, retry on agent silence, fallback coder. |
| `reviewer-role.test.js` | Reviewer JSON output validation, schema enforcement, retries. |
| `tester-role.test.js` | Tester runs `vitest`, parses results. |
| `security-role.test.js` | Security review against OWASP-like patterns. |

Top-level files cover: triage, researcher, architect, planner, refactorer, discover, hu-reviewer, impeccable, solomon, commiter.

---

### `tests/agents/` — Provider CLI wrappers

| File | Asserts |
|------|---------|
| `base-agent.test.js` | The `BaseAgent` contract (init, runTask, reviewTask, runtime budget). |
| `claude-agent.test.js` | Claude CLI subprocess: 3 workarounds (strip `CLAUDECODE` env, `stdin: "ignore"`, read from stderr). |
| `codex-agent.test.js` | Codex CLI subprocess. |
| `gemini-agent.test.js` | Gemini CLI subprocess. |
| `aider-agent.test.js` | Aider CLI subprocess. |
| `opencode-agent.test.js` | OpenCode CLI + local model proxy. |
| `create-agent.test.js` | Factory that picks the right agent per role. |
| `agent-di.test.js` | Every agent accepts an injected `Environment` (FS + Runner) so tests don't spawn real subprocesses. |

---

### `tests/session/` — Journal output

| File | Asserts |
|------|---------|
| `summary-writer.test.js` | `summary.md` structure: result, task, iterations, duration, budget breakdown by role, stages table, **Skills Used** section (KJC-TSK-0327). |
| `decisions-writer.test.js` + `decisions-journal-integration.test.js` + `ruling-capture.test.js` | `decisions.md` per-iteration Brain + Solomon decisions. |
| `iteration-logger.test.js` | `iterations.md` per-iteration coder/reviewer/sonar/Solomon detail. |
| `tree-writer.test.js` | `tree.txt` directory-grouped file changes. |

---

### `tests/skills/` — OpenSkills + addyosmani

| File | Asserts |
|------|---------|
| `addyosmani-catalog.test.js` | Shallow clone of `addyosmani/agent-skills` into `~/.karajan/agent-skills/`, weekly refresh, frontmatter parsing, path-traversal guard, graceful degradation when git is missing. |
| `addyosmani-role-map.test.js` | Role → slug map (tester→TDD, reviewer→code-review-and-quality, etc.) + task-text triggers. |
| `cache.test.js` | OpenSkills 7-day TTL cache (`~/.karajan/skills-cache/`). |
| `fallback.test.js` | Graceful "wouldHaveUsed" report when `npx openskills` CLI is missing. |
| `integration.test.js` | End-to-end: detector → install → role-filter → prompt-injection. |
| `role-filter.test.js` | Per-role skill filtering (reviewer doesn't get `pytest-patterns`, etc.). |
| `semantic.test.js` | Classifier-based skill detection (mode `auto` / `semantic`). |
| `skill-detector-extended.test.js` | Stack detection: `.csproj` → dotnet, `.ipynb` → python-data, `.prisma` → prisma, etc. |

---

### `tests/types/` — JSDoc typedef sanity

| File | Asserts |
|------|---------|
| `solomon.test.js` | Solomon's `SolomonRuling` typedef matches what `recordSolomonRuling` writes. |

---

### `tests/utils/` — Helpers

| File | Asserts |
|------|---------|
| `task-file.test.js` | `--task-file <path>` / `taskFile` MCP arg: read trimmed, size cap, missing/empty errors, precedence over positional task. |
| `cli-run-log.test.js` | `withCliRunLog()` wrapper: lifecycle markers (`started (cli)` / `finished — ok=<bool>` / `failed — <error>`), progress forwarding, fd cleanup on throw. |
| `budget.test.js` | Cost/token math primitives. |
| `project-detect.test.js` | Stack detection for prompts and skills (Astro, React, Python, Java, ...). |

---

### Top-level `tests/*.test.js` — Cross-cutting

These ~230 files don't fit into a single layer. They cover full pipeline scenarios, MCP handlers, CLI commands, and integration paths. Notable groups:

| Group | Pattern | What |
|-------|---------|------|
| **CLI commands** | `command-*.test.js` | One per `kj <cmd>`: run, code, review, audit, plan, discover, triage, researcher, architect, scan, roles. Argument parsing, flag interaction, error paths. |
| **MCP handlers** | `mcp-*.test.js` | One per MCP tool: kj_run, kj_code, kj_review, kj_plan, kj_audit, kj_discover, kj_triage, kj_researcher, kj_architect, kj_skills, kj_status, kj_resume, kj_undo, kj_init, kj_doctor, kj_hu, kj_board, kj_suggest, kj_preflight. Schema sanity + handler validation. |
| **Pipeline smoke** | `kj-run-smoke.test.js`, `orchestrator-events.test.js`, `pipeline-tracker.test.js` | Full pipeline runs end-to-end with mocked agents — the tests that catch big regressions when stages reorder. |
| **Brain wiring** | `brain-*.test.js`, `solomon-*.test.js` | Brain gateway, Solomon escalation paths, brain-skip-on-correctness, brain-rules-alert. |
| **Skills wiring** | `kj-skills.test.js`, `skill-injection.test.js`, `skills-dedup.test.js`, `nocode-skills.test.js`, `triage-auto-skills.test.js`, `skill-loader-type.test.js` | Skill resolution + Claude Agent Skills dedup + injection into role prompts. |
| **HU pipeline** | `hu-*.test.js`, `auto-hu-*.test.js`, `hu-sub-pipeline.test.js`, `hu-board-*.test.js` | Auto-decomposition, HU board sync, sub-pipeline per HU. |
| **Sonar** | `sonar-*.test.js`, `quality-gate-*.test.js` | SonarQube docker autostart, scan, quality gate, profile selection. |
| **CI / Git** | `ci-*.test.js`, `git-*.test.js` | Karajan CI gateway (early PR + dispatch), commit chunking, branch policies. |
| **Plan v2** | `plan-*.test.js` | `kj plan generate/list/show/ready/validate/delete/add-hu/remove-hu`, plan execution via `kj run --plan`. |
| **Preflight** | `preflight-*.test.js` | The bigger preflight integration tests (per-machine config, real check ordering). |
| **Resume / standby** | `resume-*.test.js`, `standby.test.js`, `cooldown.test.js` | Long-running session recovery, cooldown after rate limit, auto-resume on transient failures. |
| **Repeat detection** | `repeat-*.test.js`, `fail-fast.test.js` | When the coder loops on the same diff, stop early. |
| **Activity log** | `activity-log.test.js`, `run-log.test.js`, `kj-status-*.test.js` | The on-disk logs `kj-tail` / `kj_status` consume. |
| **Domain knowledge** | `domain-*.test.js`, `domain-loader.test.js`, `curator-*.test.js` | KJC-PCS-0029 — domain-aware pipeline with Curator role. |
| **RTK** | `rtk-*.test.js` | Token compression integration. |
| **WebPerf** | `webperf-*.test.js` | Core Web Vitals quality gate. |

---

## Architecture invariants — read this before disabling a test

These tests encode **rules**, not "best-effort coverage". Removing or weakening them must come with a documented architectural decision:

1. **`tests/architecture/no-provider-apis.test.js`** — Karajan never imports a provider SDK, never reads `ANTHROPIC_API_KEY` outside preflight, never reintroduces a `token:<provider>` check. Pre-v2.7.4 a single misnamed check blocked every Claude Code MCP run for users without env vars set; this test makes the rule enforceable in CI.

2. **`tests/checks/node.test.js`** — `MIN_NODE_MAJOR = 18`. Lowering it requires checking we don't use Node 17- features; raising it requires a deprecation cycle.

3. **`src/checks/tokens.js` post-v2.7.4** — provider checks are CLI availability (`cli:<provider>`), not env-var presence. Verified by `tests/checks/tokens.test.js` + `tests/architecture/no-provider-apis.test.js`.

4. **The session journal contract** (`tests/session/summary-writer.test.js`) — `summary.md` always contains: result, task, iterations, duration, budget, stages table, commits, journal links. Post v2.7.2 it also contains the **Skills Used** section when skill activity happened.

---

## How to debug a failing test

1. **Run it in isolation**: `npx vitest run path/to/test.js -t "specific test name"`.
2. **Add `--reporter=default`** for full output (the dot reporter swallows stack traces).
3. **Check the global flags in `tests/setup.js`** — many orchestrator tests assume Brain/skills/preflight defaults are off. If your test needs them on, opt in per-case (`config.brain.decisor.enabled = true`, etc.).
4. **For MCP handler tests**: most mock `bootstrap.js` and `agent-detect.js`. If your test crashes on `bootstrap`, double-check the mocks at the top of the file.
5. **For agent tests**: agents go through `Environment` (DI). Use `buildMockEnvironment()` from `tests/support/` instead of stubbing `execa` directly.
6. **The `tests/architecture/no-provider-apis.test.js` failing means you broke a contract**, not a test. Read the test docstring before touching it.

---

## Coverage gaps (known)

These areas have weaker coverage and are good places to contribute:

- **`tests/e2e/`** is empty. Real end-to-end tests exist as top-level `kj-run-smoke.test.js` etc., but a true e2e (spawning real Karajan against a fixture project) would catch full-stack regressions.
- **Cross-platform paths** (Windows backslash handling): partial — relies on the SEA workflow's Windows runner picking up issues post-merge.
- **Long-running session resume** edge cases: covered for the happy path; less tested for partial-state corruption.

---

## Adding a new test — checklist

- [ ] Right directory? See "Directory map" above.
- [ ] If you're testing a public contract, the test name includes the contract (e.g. `"summary.md always contains a Stages table"`).
- [ ] Mocks at the top of the file (don't mock from inside `it()` unless you `vi.resetModules()`).
- [ ] Cleanup: every `mkdtemp` goes into a `cleanups[]` array drained in `afterEach`.
- [ ] Don't import `process.env` directly — use the test setup's pre-set dummy values.
- [ ] If your code path depends on a global flag (Brain, skills mode, addyosmani), opt in inside the test via `globalThis.__KJ_DEFAULT_*` or per-case config.
