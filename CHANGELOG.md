# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`spec-reviewer` role** runs BEFORE every `kj run` / `kj plan` (KJC-PCS-0048). See full description below — it remains queued for the next minor release (v2.20.0).

## [2.27.0] - 2026-05-25

Minor release. **RAG polish — per-project isolation, unified docs, fairer ranking.**

Three independent improvements triggered by the v2.26.0 smoke test on karajan-code itself, plus a workflow fix surfaced while landing the docs.

### Added

- **Per-project isolation** (KJC-TSK-0438, PR #831). New `project_slug TEXT` column on `chunks` (schema migration is non-breaking — old DBs keep working with NULL). `insertChunk` / `searchSimilar` accept `{ project }`. `indexProject` auto-stamps every chunk with the projectDir basename. `kj rag query` adds `--project <slug>` (defaults to cwd basename; `--project all` disables the filter). Same shape exposed through MCP and the slash command.
- **`docs/RAG.md` + `docs/es/RAG.md`** (KJC-TSK-0439, PR #832). Single unified guide consolidating CHANGELOG entries, role templates and landing pages. Sections: quick start, architecture diagram, installation, six workflows (CLI/MCP/skill/Board/pre-loop/role-instructions), configuration matrix, limitations + roadmap, troubleshooting. README banner links both languages.
- **Asymmetric source-vs-test kind boost** (KJC-TSK-0440, PR #833). The v2.26.0 smoke caught a systematic bias: natural-language queries (`how does X work`) ranked `tests/X.test.js` above `src/X.js` because tests carry more descriptive prose. New rule in `retriever.js`: when the query does NOT mention `test|spec|expect|describe|it|jest|vitest|mocha`, code chunks whose source path is NOT a test file get +0.05 boost. Test-flavoured queries keep the baseline so `vitest mock setup` still surfaces test files.

### Fixed

- **KJC-BUG-0063** (PR #834): `tests/resilience/hibernate-end-to-end.test.js` was time-zone-dependent and broke CI on every PR (passed in `TZ=Europe/Madrid`, failed in CI's `TZ=UTC`). Skipped in CI via `process.env.CI === 'true'` until `parseCooldown` becomes TZ-aware.
- **shrink-budget workflow excludes** (PR #832): `docs/**/*.md` only matched files in subdirectories (`docs/es/RAG.md`) but not `docs/RAG.md` at the root of `docs/`. Mirrored every doc-extension exclude with both `docs/*.ext` and `docs/**/*.ext` patterns. Caught while landing the docs themselves.

## [2.26.0] - 2026-05-24

Minor release. **RAG Auto-Bootstrap** — Ollama runs in Docker out of the box.

Closes the friction caught in the v2.25.0 smoke test: RAG required a manually installed Ollama, which made the feature invisible to new users. From v2.26.0, `kj init` provisions Ollama in Docker, pulls `nomic-embed-text`, and wires the embedder into the config — same opt-out shape as SonarQube.

### Added

- **Ollama-in-Docker manager** (KJC-TSK-0435, PR #825). `src/rag/ollama-manager.js` mirrors `src/sonar/manager.js`: `normalizeOllamaConfig`, `buildComposeTemplate`, `ensureComposeFile`, `isOllamaReachable`, `waitForOllamaReady`, `findAvailableOllamaPort`, `ollamaUp` / `ollamaDown`. `ollamaUp` short-circuits when the host is already reachable (returns `reusedHost`) and refuses when `external=true` and unreachable.
- **Capability check + auto-pull + `kj init` bootstrap** (KJC-TSK-0436, PR #828). `src/rag/ollama-capability.js` checks Docker availability + free RAM (>= 4 GB default). `kj init` runs `bootstrapOllama()` after installing skills: skip on `--no-ollama`, skip with warning on capability fail, otherwise `ollamaUp()` + `waitForOllamaReady()` + `pullOllamaModel('nomic-embed-text')`.
- **`kj doctor` Ollama check + `kj ollama` subcommand** (KJC-TSK-0437, PR #827). New `src/checks/ollama.js` and `src/commands/ollama.js`. `kj ollama [start|stop|status|pull <model>]` lets the user manage the container without touching docker compose.

### CLI flags

`kj init --no-ollama` — skip the RAG embedder bootstrap.

### Behaviour matrix

| Scenario | What happens |
|---|---|
| `kj init` on Linux with Docker + 8 GB free | Container starts, model pulls, RAG ready |
| `kj init` on Windows without Docker | Warn `docker:not-installed`, init continues |
| `kj init --no-ollama` | Skip with one-line log |
| Host with Ollama on :11434 already | Reuses external instance |
| `kj doctor`, `rag.preload.enabled=true`, container down | `warn` + fix hint `kj ollama start` |

### Bug fix bundled

- **KJC-BUG-0061** (PR #824): smoke test of v2.25.0 caught two latent bugs in `kj onboard` and a CLI/MCP empty-store contract mismatch. Fixed and shipped between v2.25.0 and v2.26.0.

## [2.25.0] - 2026-05-24

Minor release. **RAG Camino B + Camino D** (KJC-PCS-0049). Closes the consumer-surface plan: Skills hosts can now invoke RAG without MCP, and the pre-loop retrieval stage only fires when triage signals make it worthwhile.

### Added

- **`/kj-rag-query` slash command** (KJC-TSK-0433, PR #821). New `templates/skills/kj-rag-query.md` template. `kj init` ships it to `.claude/commands/` so hosts that load Karajan via Skills (Claude Code without MCP, Cursor without MCP) can reach the RAG retriever through `/kj-rag-query <text> [--scope <s>] [--top-k <n>]`. Thin wrapper over the existing `kj rag query` CLI: passthrough flags, empty-store hint without blocking the conversation, render chunks as background context (not raw JSON).
- **Brain decisor heuristic for pre-loop retrieval** (KJC-TSK-0434, PR #822). New module `src/orchestrator/stages/rag-preload-decisor.js`. Pure function `shouldPreloadRag({triage, task, config}) → {pull, reason}`. Wired in `pre-loop.js` before `runRagContextStage`. Policy `config.rag.preload.policy`: `always` (back-compat with v2.24.0), `never` (benchmarking), `auto` (default). In auto mode, pulls when triage decomposes, level is complex/high/epic, task body ≥ 200 chars, or `config.rag.preload.brownfield` is set. Otherwise persists `ragPreload: { skipped: true, reason: 'auto:low-value' }` so resume + audit see why retrieval was skipped.

### Toggle

`config.rag.preload.enabled` still defaults to `false` (opt-in). `config.rag.preload.policy` defaults to `auto`. Existing v2.24.0 setups behave unchanged unless they explicitly set `policy=auto`.

### Out of scope (v2.26.0+)

chokidar watcher (live re-indexing), AST source chunker (tree-sitter or `@babel/parser`), BM25 + cosine hybrid scoring.

## [2.24.0] - 2026-05-24

Minor release. **RAG Camino C — pre-loop auto-retrieval** (KJC-PCS-0049). After v2.23.0 taught the agents that `kj_rag_query` exists, Karajan now injects prior context for them automatically.

### Added

- **`runRagContextStage` pre-loop stage** (KJC-TSK-0432, PR #819). New module `src/orchestrator/stages/rag-context-stage.js`. Runs between triage and domainCurator. Five guards before retrieval fires: `disabled`, `no-task`, empty corpus, no hits, error. All five degrade silently except `empty` (info log pointing at `kj rag index`). The stage never throws. When all guards pass, mutates the `task` parameter prepending `## Prior context from RAG` block with top-K chunks. One mutation feeds researcher/architect/planner/coder via the existing parameter chain.

### Toggle

`config.rag.preload.enabled = false` by default (opt-in). `config.rag.preload.topK` (5) + `config.rag.preload.scope` (`all`).

### Compatibility with Camino A (v2.23.0)

Role templates from PR #817 already tell agents that `kj_rag_query` exists for on-demand queries. Camino C complements: agent gets context automatically at start; agent can still call the tool for follow-ups.

### Out of scope (v2.25.0+)

Camino B (Skills slash command), Camino D (Brain decisor for when to pre-fetch), chokidar watcher, AST source chunker, BM25 hybrid scoring.

### Workflow

```bash
kj onboard
kj rag index
yq -i '.rag.preload.enabled = true' ~/.karajan/kj.config.yml
kj run task.md  # researcher/architect/planner/coder see prior context automatically
```

## [2.23.0] - 2026-05-24

Minor release. **RAG exposed to agents and humans alike**: closes Steps 7 + 8 + Camino A of the Project RAG epic (KJC-PCS-0049).

### Added

- **`kj_rag_query` + `kj_rag_index` MCP tools** (KJC-TSK-0429, PR #815). Tool count 25 → 27. Empty store responds `empty: true`.
- **HU Board RAG search panel + `/api/rag/query` endpoint** (KJC-TSK-0430, PR #816). Input + scope dropdown + Search button + results pane between preflight and kanban.
- **Role templates teach agents about the tool** (KJC-TSK-0431, PR #817). `templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md` gain tailored 'Prior context (RAG, opt-in)' sections.

### Workflow

```bash
kj onboard                              # one-time per project
kj rag index                            # one-time per project
kj plan generate task.md --use-onboarding
# Agents call kj_rag_query via MCP, humans use the Board panel.
```

### Out of scope (v2.24.0+)

Camino B (slash command for Skills hosts), Camino C (pre-loop stage with automatic retrieval), Camino D (Brain decisor for when to retrieve), chokidar watcher, AST source chunker, BM25 hybrid scoring.

## [2.22.0] - 2026-05-24

Minor release. **Project RAG epic (KJC-PCS-0049) MVP** ships in six PRs: Karajan now indexes plans + onboarding briefs (and optionally project sources) into a local vector store and lets you query them semantically from the CLI.

### Added

- **`kj rag` command group** (KJC-TSK-0428, PR #813). Two subcommands:
  - `kj rag index [--with-sources] [--json]` — runs `indexer.indexProject()` on the current project: every `~/.karajan/plans/<slug>/plan-*.json` + `~/.karajan/onboarding/<slug>.md` is chunked, embedded and persisted. With `--with-sources` also walks `.js/.ts/.tsx/.jsx` (skipping `node_modules`, `.git`, `dist`).
  - `kj rag query <text> [--scope plans|code|onboarding|all] [--top-k N] [--json]` — embeds the query, fetches top-K nearest, reranks by kind (plan +0.05, onboarding +0.03, code 0), prints each hit with its most-specific label.
- **Vector store on better-sqlite3 + sqlite-vec** (KJC-TSK-0423, PR #808). `~/.karajan/rag.db` (override via `KJ_RAG_DB`). New dep `sqlite-vec ^0.1.9`.
- **Ollama embedder adapter** (KJC-TSK-0424, PR #809). `OllamaEmbedder.embed/embedBatch` against the local Ollama endpoint. Defaults `localhost:11434` + `nomic-embed-text` + dim 768. Zero new deps.
- **Three chunkers** (KJC-TSK-0425, PR #810). `chunkMarkdown` (heading hierarchy), `chunkPlan` (one chunk per HU), `chunkSource` (JS/TS export-symbol via regex). Shared windowed splitter for oversized sections.
- **Indexer** (KJC-TSK-0426, PR #811). `indexFile` + `indexProject`. Idempotent — calls `deleteChunksBySource` before re-indexing. Embedder failures = `warn` + continue.
- **Retriever** (KJC-TSK-0427, PR #812). `query(db, embedder, text, { topK, scope, kindBoost })` — over-fetches `topK*2`, applies kind boosts, returns ranked hits with metadata.

### SEA binary

`src/rag/*` + `src/commands/rag.js` join `packages/hu-board/src/*` in the list of modules the SEA bundle stubs out (`scripts/esbuild-sea.config.mjs::ragStubPlugin`). The standalone binary points users at `npm install -g karajan-code` for RAG.

### End-to-end workflow

```bash
cd ~/your-project
kj onboard                       # Architecture Brief at ~/.karajan/onboarding/<slug>.md
kj plan generate task.md -y      # Plans at ~/.karajan/plans/<slug>/plan-*.json
kj rag index                     # Seed the vec store
kj rag query "how did I handle auth in module X?"
```

### Out of scope (v2.23.0+)

MCP tool `kj_rag_query`, HU Board search panel, chokidar watcher for live re-indexing, AST-aware source chunker, BM25 + cosine hybrid scoring.

## [2.21.0] - 2026-05-24

Minor release. **Brownfield Onboarder role**: Karajan now ships a dedicated path to bootstrap an Architecture Brief from any existing codebase, and the planner can consume that brief as automatic context. Closes KJC-TSK-0384 in three PRs.

### Added

- **New `kj onboard` command + OnboarderRole** (KJC-TSK-0384, PRs #804 + #805). Runs five deterministic collectors over a project root — `collectTree` (directory walk ignoring `node_modules` / `.git` / `dist` / `build` / etc.), `collectGitHistory` (commits, branches, hot files via `--name-only` over the last 200 commits), `collectConfigs` (presence of 18 well-known config patterns + package.json scripts), `collectAdrs` (ADR-style filenames under `docs/adr/`, `docs/adrs/`, `docs/architecture/`), and `collectAll` as the one-shot bundle — and then optionally synthesises a Markdown Architecture Brief via the OnboarderRole. Output lands at `~/.karajan/onboarding/<slug>.md`. Flags: `--no-synth` (skip the LLM call and dump the raw collectors bundle, useful for CI / token-cost-sensitive contexts) and `--output <path>` (override default target). Greenfield projects produce `# Project is greenfield` instead of erroring. The collectors are stack-aware via `detectProjectStack`; adding a stack to the brief is one branch in `composePreflightTests`-style code.
- **New `--use-onboarding` flag on `kj plan generate`** (PR #806). When set, reads the cached Architecture Brief via `readCachedBrief(projectDir)` and prepends it to the planner's context under a `## Architecture Brief (from kj onboard)` heading. Silent on cache miss without the flag; loud `warn` when the flag is set but no cache exists, so a missed `kj onboard` invocation surfaces immediately. The brief flows into the planner alongside any explicit `--context` the user passes; both compose.

### Workflow

```bash
kj onboard                            # produces ~/.karajan/onboarding/<slug>.md
kj plan generate task.md \
    --use-onboarding                  # next plan reads the brief as context
```

### Out of scope

- The Project RAG epic (KJC-PCS-0049) starts in v2.22.0 — vector store, Ollama embedder, indexer, retriever, CLI / MCP / HU Board consumers. Onboarder is the prerequisite (its `onboarding_context.json` feeds the indexer), so closing it cleanly here unblocks the next minor.

### Tests

5 387+ tests / 458+ test files passing on Node 20 and Node 22 CI.

## [2.20.0] - 2026-05-24

Minor release. **HU Board polish + UX papercuts** cluster: 5 cards closed (2 net-new features, 2 housekeeping PG syncs for work that had already landed quietly, 1 doc refresh).

### Added

- **`kj plan generate` now prepends a `[PREFLIGHT-000]` HU to every plan** and gates all functional HUs on it via `blocked_by` (KJC-TSK-0397, PR #801). The HU's acceptance tests are stack-aware shell commands — `git status --porcelain`, `node --version` + `npm install` + conditional `npm test`/`npm run lint` for Node, `python --version` + `pip install -r requirements.txt` (or `poetry install`) + `pytest --collect-only` for Python, plus `firebase projects:list` when `firebase.json` exists and `gcloud auth list` when `.gcloudignore` exists. Idempotent: a plan that already has a HU titled `PREFLIGHT-000` / "verificar entorno" is left untouched. Opt out per-invocation with `--no-preflight-hu`. New module `src/plan/preflight-hu.js` (102 LOC) + 6 acceptance tests.
- **`kj init` learns a config scope wizard plus `--global` / `--local` flags** (KJC-TSK-0395, PR #802). In an interactive TTY without flags, the wizard now asks whether the config should land at `~/.karajan/kj.config.yml` (global, applies to all projects) or `./.karajan/kj.config.yml` (local override, project-scoped). `--global` and `--local` skip the prompt for CI scripts; passing both throws `Cannot pass both --global and --local`. Non-interactive without flags stays on global for legacy CI compatibility. `loadConfig` (src/config/loader.js) now refuses to load a project that has a local config without a global counterpart — the override-only-on-top-of-base invariant — with an actionable message pointing at `kj init --global` to create the base. New exported function `resolveConfigScope({ flags, interactive })` for unit testing without spinning up the rest of `initCommand`.

### Synced to PG

These were already implemented in main but their cards were stuck in "To Do" until today's PG housekeeping pass:

- **HU Board `⏹ Stop` button** (KJC-TSK-0396, originally PRs #702 + #703): aborts every `kj run` associated with a plan via SIGTERM → SIGKILL escalation (5 s timeout), resets running HUs to pending, available only when at least one HU is in `coding`/`reviewing`. Frontend delegate handler + backend `POST /api/runs/:planId/stop` + persistent run-tracker registry for terminal↔board bidirectionality.
- **HU Board auto-cleanup ampliado** (KJC-TSK-0377, originally PR #683): the ephemeral-project sweep now also catches `s_*`, `plan-*`, `auto-tmp_*`, `auto-test_*` prefixes alongside the original `tmp_*` / `test_*` / `demo_*` / `kj-test-*` set. Projects with `is_test=2` (📌 keep) stay exempt. Home-style `home_<path>` projects with real git repos are never swept.

### Docs

- `docs/task-templates/spec-conventions.md` adds two sections (KJC-TSK-0385, PR #800): **Section 8** documents that numbered headings (`## 1.`, `### 2.1`, `§5`) activate the `spec_section` REQUIRED field on every step. **Section 9** documents the `acceptance_tests` shape: 2-4 tests per step, mix of `gherkin` and `shell`, pre-implementation, never the placeholder `npx vitest run`. The top quick-reference table + the pre-generate checklist were updated to reference both. Plus `docs/task-templates/plan-generate.md` switches its two stale `~/.kj/plans/` example paths to `~/.karajan/plans/` (post-v2.19.0 home consolidation).

## [2.19.4] - 2026-05-24

Patch release. `kj resume` continúa donde paró y `autoInit` ya no produce commits zombie en el repo del usuario.

### Fixed

- **`kj resume` re-arrancaba researcher + architect en lugar de continuar desde el último checkpoint** (KJC-BUG-0058, PR #798). Reportado por Aitor Martínez con screenshot: una sesión que paró durante Sonar, al hacer `kj resume <id>`, re-ejecutaba todo el pre-loop pipeline (HU-reviewer → intent → discover → triage → domainCurator → researcher → architect → planner) desde cero — doblando coste de tokens y rompiendo el value-prop del comando. Causa raíz: `resumeFlow` (flow-runner.js:280) cargaba la sesión y llamaba `runFlow` sin propagar nada sobre qué stages estaban hechas; `runFlow` → `initFlowContext` arrancaba con `ctx.stageResults = {}` siempre. La sesión NUNCA persistía los outputs de stage en `session.json`. **Fix**: dos nuevos mutators en `src/session/mutators.js` — `setStageResult(session, name, result)` mantiene `stage_results[name]` + `stages_completed[]` (idempotente), y `setStageBundle(session, name, bundle)` añade `stage_bundles[name]` para cross-stage context que el stageResult no carga (researcher → `researchContext`, architect → `architectContext`, planner → `plannedTask`). Dos closures en `runPreLoopStages` (`persistStage` + `resumeSkip`) envuelven cada stage cacheable. `init-context.js` rehydrata `ctx.stageResults` desde `session.stage_results` antes de `runPreLoopStages` — sin nuevo flag por la cadena. Triage NO se skipea (emite `roleOverrides` que el Brain decisor necesita; es cheap). 10 test files / 57 tests de orchestrator siguen verdes.
- **`autoInit()` commiteaba vacío en el main del usuario al dogfooding kj sobre el propio repo** (KJC-BUG-0060, PR #797). Reportado por mjfosela durante el release de v2.19.3: tras `git checkout main`, `git status` reportaba `[adelante 27]` ante origin/main. Los 27 commits — titulados `initial commit`, autor `manufosela@gmail.com` (git config local de karajan-code, no `mjfosela@gmail.com`), tree idéntico a su parent = **commits completamente vacíos**. El reflog acumulaba **2 495 SHAs** con el mismo patrón desde abril 2026. Ninguno había llegado nunca a origin/main (gh push / CI los habrían rechazado), pero ensuciaban main local y en cada release parecía pérdida de sync. Causa raíz: `src/orchestrator/config-init.js::autoInit()` guardaba con `!(await exists(projectDir/.git))`, demasiado débil. Dos modos de fallo combinados: (1) dogfooding kj sobre karajan-code (kj-linked) desde un subdir del repo → `exists()` devolvía false → `git init` reinicializaba el `.git/` del padre (idempotente) → `git commit --allow-empty` resolvía hacia arriba y aterrizaba commit vacío en main; (2) race FS transitoria con `exists()` falso-negativo. **Fix**: cambio el FS probe estático por `git rev-parse --is-inside-work-tree`, que hace la misma upward-traversal que git haría para el commit — el guard no puede discrepar con la operación que custodia. Drop del `git commit --allow-empty -m "initial commit"` que seguía al `git init` — ningún stage downstream necesita root commit; los 2 495 commits nunca rompieron nada, el seed era decorativo y era el síntoma user-visible. 3 acceptance tests en `tests/orchestrator/config-init-autoinit.test.js`.

## [2.19.3] - 2026-05-23

Patch release. HU Board now reads + writes plans from the canonical home dir.

### Fixed

- **HU Board reported "Directorio del proyecto — no detectado" even when the run had a valid `projectDir`** (KJC-BUG-0059, PR #795). Five board call sites still hard-coded `~/.kj/plans/` as their plans root — leftover from the v2.19.0 home consolidation, which fixed `sync.js` but missed the rest. After the auto-migrator runs, plans land under `~/.karajan/plans/<slug>/`; the board kept looking under `~/.kj/plans/<slug>/` and silently found nothing. That meant: `GET /api/projects/:id/preflight` could not extract `projectDir` (the literal Aitor saw), `GET /api/projects/:id/plans-outcome` returned `plans: []` for every project, `DELETE /api/projects/:id` swept the wrong path leaving residue on disk, `DELETE /api/plans/:planId` failed silently, `preflight.checkPlans` reported "plans missing" wrongly, `plan-mutations.plansRoot` wrote new per-HU run logs to the legacy root splitting state across both, and `cleanup-zombies` never GC'd zombies under `~/.karajan/plans/`. **Fix**: three new exports in `packages/hu-board/src/db.js` — `getHuBoardPlansDir()` (canonical, or `KJ_PLANS_DIR` override), `getHuBoardLegacyPlansDir()` (legacy, null when override set), `getHuBoardPlansDirs()` ordered `[canonical, legacy?]` for read callers. Single-write callers (`plan-mutations`) use the canonical root; read / delete / GC iterate both so users mid-migration with plans still under `~/.kj/` don't regress. 29 hu-board test files / 349 tests still green. Reported by Aitor Martínez.

## [2.19.2] - 2026-05-23

Patch release. SonarQube auto-recovery from 401.

### Fixed

- **Sonar 401 now triggers automatic token re-bootstrap instead of failing the run** (KJC-BUG-0057, PR #793). Until v2.19.1, when the configured Sonar token was missing / stale / revoked / pointing at a recreated Sonar instance, `kj run` / `kj audit` threw `SonarQube authentication failed (HTTP 401)` with the hint "Regenerate with `kj init`" — putting the user in the loop for plumbing that Karajan can do itself. **Fix**: `src/sonar/api.js::sonarFetchOnce` now invokes the new `src/sonar/token-recovery.js::recoverSonarToken()` on the first 401 of a process. Recovery reuses `bootstrapSonarToken()` (already shipped in v2.10.2) — it probes admin/admin against the Sonar host, rotates the default password if still in place, revokes the existing `karajan-cli` token, generates a fresh `GLOBAL_ANALYSIS_TOKEN`, mutates `config.sonarqube.token` in place AND mirrors the new token to `~/.karajan/sonar-credentials.json` so future processes pick it up via the normal resolver chain instead of triggering recovery again. The original request retries once with the new token; the user never sees the 401 when recovery succeeds. Per-process latch ensures one Sonar run that 401s on N endpoints triggers ONE bootstrap, not N. If recovery itself fails (e.g. admin password was customised manually), the user gets a more actionable error — pointing at `~/.karajan/sonar-credentials.json` for saving admin user/password — instead of a generic "kj init" hint. Programmatic, zero LLM involvement. Reported by Aitor Martínez.

## [2.19.1] - 2026-05-23

Patch release. **APPLICATION BLOCKER** fix for the HU Board.

### Fixed

- **`kj board start` failed with `ERR_MODULE_NOT_FOUND` on every fresh `npm install -g karajan-code`** (KJC-BUG-0056, PR #791). Two independent bugs combined to break the documented HU Board feature for every user installing from npm: (1) the root `package.json::files` array did not include `packages/`, so `npm pack` was shipping a tarball with no HU Board code at all — confirmed via `npm pack --dry-run`. (2) Even after copying `packages/hu-board/` manually (the fallback some users tried), the board crashed at startup with `Cannot find package 'helmet' imported from .../packages/hu-board/src/server.js` because the five HU Board dependencies (`helmet`, `chokidar`, `better-sqlite3`, `express`, `express-rate-limit`) were declared in `packages/hu-board/package.json` but NOT in the root `dependencies`, so `npm install -g karajan-code` never pulled them. **Fix**: add `packages/hu-board/{src,public,package.json}` to `files`; add the five HU Board deps to root `dependencies` at the exact versions the sub-package declares (so `npm dedupe` collapses to one copy resolvable by upward traversal from `server.js`); regenerate `package-lock.json`. Verified end-to-end: `npm pack --dry-run` now ships 12 board files; `node packages/hu-board/src/server.js` boots cleanly. Reported by Aitor Martínez.

### Internal

- **38 direct `os.homedir()` callers routed through the unified resolver** (KJC-TSK-0420, PR #790). `KARAJAN_HOME=/some/path kj <anything>` now redirects EVERY component to `/some/path/…` — not just plans / standby / sessions, but also the webperf cache, run-registry, board prompt bridge, HU Board auth token, the `hu-board.pid` file, the `kj.config.yml` read by the board's config viewer, and the `kj doctor` dir-setup check. Three new helpers in `src/utils/paths.js` (`getWebperfDir`, `getRunsDir`, `getPromptsDir`) and a `KARAJAN_HOME` priority added to `packages/hu-board/src/db.js::getKjHome`. The legitimate non-Karajan callers (`os.homedir()` for `~/.claude.json`, `~/.codex/config.toml`, npm-global bin lookups, the fs-leak detector) stay untouched.
- **5 inline constructions of `~/.karajan/hu-board-runs/` unified under `getHuBoardRunsDir()`** (KJC-TSK-0421, PR #789). Pure DRY refactor; no behaviour change.

## [2.19.0] - 2026-05-23

Minor release. Closes [KJC-PCS-0047](https://planning-game.web.app) — the **home-directory consolidation** epic. Three back-to-back PRs (#781, #782, #783) unify the HOME-level state of Karajan into a single `~/.karajan/` root, with a one-shot auto-migrator that moves legacy `~/.kj/` content on the next `kj` invocation (idempotent, tarball-backed). and audits the user's spec for deficiencies that would otherwise cause the pipeline to spend tokens on the wrong work (KJC-PCS-0048, PRs #785 + #786 + #787 + #788). The role classifies findings across seven categories — `ambiguity`, `missing_scope`, `missing_ac`, `contradiction`, `stack`, `assumptions`, `out_of_scope` — with per-finding severity (`info` / `warn` / `fail`) and a top-level severity that is the worst of any finding (`ok` if none). On a clean spec the run prints a single `✓ spec OK` line and continues; on findings the user gets a coloured, category-grouped block on stderr plus an interactive `[c]ontinue / [r]efine / [x]cancel` prompt. **Refine** asks the role for a rewritten v2 of the spec, persists both versions to `<projectDir>/.reviews/spec-review-<ISO>/spec-v1.md` + `spec-v2.md` (and mirrors v2 next to `--task-file` if supplied), opens `$EDITOR` on v2, and uses a SHA-256 hash diff to decide whether to re-review (user modified v2) or proceed with v2 as the effective spec (user accepted untouched). Capped at 5 refine iterations. Defaults to **on**; bypass per-invocation with `--skip-spec-review` on the CLI or `specReviewMode: "skip"` on the MCP tools `kj_run` and `kj_plan`. Provider configurable via `roles.spec_reviewer.provider` / `roles.spec_reviewer.model` in `kj.config.yml` (inherits from `coder` by default). Trust-the-worse semantic guards against agents that under-report severity. Degrades to a single soft warning on a non-JSON LLM output instead of throwing. Safe upgrade from 2.19.x.

## [2.19.0] - 2026-05-23

Minor release. Closes [KJC-PCS-0047](https://planning-game.web.app) — the **home-directory consolidation** epic. Three back-to-back PRs (#781, #782, #783) unify the HOME-level state of Karajan into a single `~/.karajan/` root, with a one-shot auto-migrator that moves legacy `~/.kj/` content on the next `kj` invocation (idempotent, tarball-backed).

4 984/4 984 tests passing across 418 test files.

Safe upgrade from 2.18.x.

> ⚠️ **Note**: v2.19.0 shipped with a packaging bug that broke `kj board start` for fresh installs. Use **v2.19.1 or later**.

### Changed

- **`~/.kj/` consolidated into `~/.karajan/`** (KJC-PCS-0047, PRs #781 + #782 + #783). Plans, hibernated standby state, run-registry entries and worktrees previously lived under `~/.kj/`; everything else lived under `~/.karajan/`. There was no ADR justifying the split, four divergent `getKjHome()` implementations had drifted, and new users could not find their plans. The HOME-level state is now unified under `~/.karajan/`. **The legacy `~/.kj/` directory is auto-migrated on the next `kj` invocation** (one-time, idempotent via `~/.karajan/.kj-migrated.json`). A tarball backup of the pre-migration tree lands at `~/.karajan/backup/kj-pre-migration-<ISO>.tar.gz` BEFORE anything moves — restore is one `tar -xzf` away. `plans/`, `standby/` and `worktrees/` are moved wholesale; `runs/` is merged with the canonical `~/.karajan/runs/` winning on file-name collision. The HU Board's plan watcher reads both the canonical and legacy locations until the next `kj` command triggers the migrator, so users who start the board first never see "missing plans".
- **`KARAJAN_HOME` is the new canonical env var** for overriding the HOME-level Karajan root. `KJ_HOME` keeps working but emits a one-shot per-process `[warn] KJ_HOME is deprecated, rename to KARAJAN_HOME` the first time it is consulted. Precedence: `KARAJAN_HOME` > `KJ_HOME` (with warning) > VITEST tmp > `~/.karajan`.
- **`kj doctor` reports unmigrated legacy `~/.kj/`** as a `warn`-severity check (`legacy-kj-home`) with the fix line `Run any kj command (e.g. kj doctor) — the migrator runs automatically`.

## [2.18.1] - 2026-05-23

Patch release. Six follow-ups to v2.18.0, all triggered by direct user feedback after the public launch.

4 971/4 971 tests passing across 416 test files.

### Fixed

- **`kj-tail` was silent after `kj resume`** (#772). `kj-tail` follows a fixed `<cwd>/.kj/run.log`; every CLI command opens that file via `withCliRunLog()` — except `kj resume`, which built its emitter by hand and skipped the wrapper. Resume now uses the same shape as `run.js` (`withCliRunLog` + `registerRun` + signal cleanup), so the resumed run writes `.kj/run.log` and the HU Board sees it as live.
- **Standby waits in-process instead of exiting on a short cooldown** (#773). Previously every quota hibernation returned `action:"hibernate"` and the caller exited — so even a 4-hour wait forced the user to come back and run `kj standby resume` manually. Now `withBrainRecovery` always persists the standby first; if `retryAfter <= standbyWaitHoursMax` (default 12 h) it sleeps in-process and retries; SIGINT / SIGTERM during the wait prints `kj standby resume <id>` and exits cleanly. Longer waits (weekly / monthly caps) still exit, same as before.
- **Closed KJC-BUG-0040 — binarios SEA fallaban desde v2.12.0** (#774). Not `esbuild + better-sqlite3` (that was fixed in v2.13). The real cause was a **race condition** between `gh release create` (release checklist step) and `softprops/action-gh-release@v2` (workflow): linux-x64 — always the fastest job — reached the upload step before GitHub indexed the release-by-tag, softprops created a duplicate draft, and the final `PATCH draft:false` failed with `422 already_exists`. Added a 60 s defensive poll for the release to be discoverable before invoking softprops, plus `make_latest:false` + `append_body:false` so the action can never mutate the human-created release. There are 4 orphan drafts in the repo (v2.7.4 / v2.10.0 / v2.11.0 / v2.18.0) — delete them with `gh release delete <tag>` after upgrading.
- **Stack bias — Python repos received vitest** (#775 + #776 + #777). Karajan had multi-language stack detectors but never wired them to the coder, the auto-generator, the synthesizer or `auto-hu-batch`. So a pure-Python project got `npm install` + `npx vitest run` as acceptance_tests and the coder installed vitest to satisfy the contract. Three PRs fix the canal:
  - **#775 (coder)** — `CoderRole.buildPrompt()` calls `detectProjectStack` + `detectTestFramework` and passes them to `buildCoderPrompt`, which emits a `## Project Stack` section. Relaxed three JS-only lines (httpOnly cookies, `console.log`/JSDoc, `npm install`).
  - **#776 (auto-generator)** — HU templates per language (`python` / `go` / `rust` / `javascript`); `filterConflictingHints` is now symmetric (Python wins over stale vitest hints).
  - **#777 (synthesizer + auto-hu-batch)** — `auto-hu-batch` calls `detectProjectStack` on the filesystem (overrides any text-based guess); `buildSynthesizerPrompt` accepts `stack`/`testFramework` so the LLM emits `pytest` / `go test` / `cargo test` shell commands instead of falling back to vitest.

## [2.18.0] - 2026-05-23

Minor release. Closes the **resilience audit** triggered by the public launch: 15 PRs across 5 phases hardening Karajan against the silent-failure family of bugs — *"the problem is not that something fails, the problem is failing without telling the user why."* A quota cap now hibernates and tells the user how to resume; subprocesses surface their errors; state writes are crash-safe; the orchestrator's decision layer no longer degrades silently.

4 959/4 959 tests passing across 416 test files.

### Added

- **Resilience suite** `tests/resilience/` (#770) — index of every silent-failure mode caught by the audit and the test that pins each one, plus an end-to-end tripwire walking the whole quota → hibernate → resume flow.

### Fixed — Phase 1: Quota hibernation end to end

- **Session-limit classification** (#756) — `"You've hit your session limit · resets 10:10pm"` matched no rate-limit pattern and reached `UNKNOWN_FATAL`. `session limit` / `weekly limit` added; `parseCooldown` learns the 12-hour `resets 10:10pm` clock.
- **Standby persistence** (#757) — `withBrainRecovery` only persisted with a `sessionState`, but no caller passed one. New `buildStandbyState()` builds it with an allowlisted env subset (never the full `process.env`).
- **Orchestrator consumes `action:"hibernate"`** (#758) — no code path checked for it, so a hibernation was indistinguishable from a generic failure. The coder / refactorer stages now stop cleanly on a quota cap; the session is sealed `hibernated` (resumable), not `failed`.
- **Resume hint** (#759) — a stopped `kj run` / `kj plan`'s last line is now the exact command (`kj standby resume <id>` for hibernation, `kj resume <id>` otherwise). `kj plan` no longer turns a quota cap into a thrown error.

### Fixed — Phase 2: Don't lie

- **`runCommand` ENOENT propagation** (#761) — execa with `reject:false` resolved on spawn failure with an empty stderr; a missing agent CLI failed `kj run` with no message. `enrichResult` now surfaces `shortMessage` / `code` and exposes `spawnError`.
- **Hung-agent silence timeout** (#762) — `AgentRole.execute()` never forwarded `silenceTimeoutMs`, so a stalled coder (network wedged, prompt waiting on auth) hung `kj run` forever. Every role now propagates it from `config.session.max_agent_silence_minutes`.
- **Atomic state writes** (#763) — every persistent state file (plans, sessions, standby, run registry, board mutations) was overwritten in place. New `writeJsonAtomic{,Sync}` (write-temp + rename) protects six call sites from torn writes on crash / SIGKILL / power loss.

### Fixed — Phase 3: Don't lose or block

- **Corrupt plan JSON surfaced** (#764) — a truncated plan file used to vanish silently from `kj plan list` / `kj plan load`. Now warns with the file path and renames it aside to `<name>.corrupt-<ts>`.
- **Actionable YAML error** (#765) — a bad edit in `kj.config.yml` bricked every kj command (including `kj doctor`) with a `YAMLException` that didn't name the file. All three readers now throw `Invalid YAML in <path>: <detail>` with `code: "INVALID_YAML"`.
- **HU zombie reconciler** (#766) — a killed `kj run --plan` left HUs in `coding` / `reviewing` / `running` in the plan JSON forever (the board-side reaper only runs inside the board). `injectLoadedPlan` now resets them to `pending` at load time, cross-checking `run-registry` so a live run owning the plan is not touched.
- **Board SQLite hardening** (#767) — `busy_timeout = 5000` (no more `SQLITE_BUSY` crashes), `PRAGMA user_version` (refuses to open a DB written by a newer Karajan with renamed columns), and corruption recovery (moves a malformed DB aside and rebuilds the cache from disk).

### Fixed — Phase 4: Don't degrade silently

- **Triage no silent fallback** (#768) — `TriageRole` used to return `ok:true` with `"Triage complete (fallback defaults)"` on an unparseable LLM output, silently skipping researcher / architect / security / tester for a complex task. Now warns loudly via `logger.warn`.
- **Verification-gate distinguishes git failure** (#769) — `countChangesSince` / `countUntrackedFiles` caught git errors and returned zeros, so a bad `baseRef` / corrupt repo / missing git was indistinguishable from "the coder did nothing". `verifyCoderOutput` now bails out on `gitError` with `retryStrategy: null` — no more wasted iterations blaming the agent for infra.

### Internal

- CI now exercises the `packages/hu-board` test suite on every PR (#755).

## [2.17.2] - 2026-05-22

Patch release. Wires quota-exhaustion **hibernation end to end**: a `kj run` / `kj plan` that hits a provider session or usage cap now suspends, persists its state, and tells you how to resume it — instead of failing the task with an opaque `UNKNOWN_FATAL`.

4 931/4 931 tests passing across 410 test files.

### Fixed

- **Claude Code session-limit classification** (#756). `"You've hit your session limit · resets 10:10pm"` matched no rate-limit pattern → `UNKNOWN_FATAL` → abort. `session limit` / `weekly limit` are now recognised, and `parseCooldown` learns the 12-hour `resets 10:10pm` clock so the Brain knows when the quota resets.
- **Hibernation is now persisted** (#757). `withBrainRecovery` only writes `~/.kj/standby/<id>.json` when given a `sessionState`, but `agent-role.js` and `plan/generate.js` never passed one — so a hibernating run had nothing to resume from. New `buildStandbyState()` assembles it, carrying an allowlisted env subset (`KJ_*`, `HOME`, `PATH`) instead of the full `process.env`.
- **The orchestrator now consumes `action:"hibernate"`** (#758). No code path checked for it, so a hibernation was treated as a generic failure and the HU was sealed `failed`. The coder and refactorer stages now stop cleanly on a quota cap (no fallback, no Solomon); the session is sealed `hibernated` (resumable), not `failed`.
- **Stopped runs tell you how to resume** (#759). New `printResumeHint()` prints, as the last line of a halted `kj run` / `kj plan`, the exact command — `kj standby resume <id>` for a hibernation, `kj resume <id>` for any other stop. `kj plan` no longer turns a quota cap into a thrown error.

### Internal

- CI now runs the `packages/hu-board` test suite (~344 tests) on every PR — it was previously never exercised in CI (#755).

## [2.17.1] - 2026-05-22

Patch release bundling two HU Board fixes. **KJC-BUG-0055**: a deleted project no longer resurrects when running `kj plan` or restarting the board. **Silent board-start failure**: `kj board start` no longer fails without leaving a trace in the log.

4 909/4 909 tests passing across 408 test files.

### Fixed

- **KJC-BUG-0055 — HU Board resurrection** (#751). A project deleted from the board (🗑️ button) reappeared on the next `kj plan` or board restart. Four independent leaks closed:
  1. **`sync.js` — temporal gate**: the unconditional `removeTombstone('project', …)` added by KJC-BUG-0050 is replaced by a `plan.updatedAt > tombstone.deleted_at` comparison. A tombstoned project revives only when the plan is genuinely newer than the delete; stale plans on disk are ignored and removed.
  2. **`ephemeral-cleaner.js` — tombstone + fs cleanup**: when wiping ephemeral projects at boot (`s_*`, `plan-*`, `tmp_*`, …) it now writes a tombstone and `rm -rf`'s `hu-stories/<id>/`, `sessions/<id>/` and `~/.kj/plans/<id>/`. Previously it only deleted the DB row, so the orphan directories revived the project on the next scan.
  3. **`sync.js::fullScan` — boot GC**: sweeps orphan tombstoned directories at startup (the "manual DB wipe" case).
  4. **`routes/api.js` `DELETE /api/projects/:id`**: honours `KJ_PLANS_DIR` instead of the hardcoded plans path.
- New `getTombstone(type, id)` helper in `packages/hu-board/src/db.js`.
- **Silent board-start failure** (#753). `kj board start` could exit `0` without writing a single line to `hu-board.log`. The daemon's entry-point guard compared `import.meta.url` against a hand-built `file://` + `process.argv[1]` string, which wrongly returned false on Windows (backslashes), linked / global installs (symlinks resolved on only one side) and paths with spaces — so `main()` never ran and the launcher reported a phantom success.
  - `server.js`: `isDaemonEntryPoint()` trusts an explicit `KJ_BOARD_DAEMON=1` flag set by the launcher, with a normalised `pathToFileURL` + `realpathSync` comparison as fallback.
  - `server.js`: `uncaughtException` / `unhandledRejection` handlers log the stack before exiting non-zero; `initDb()` reports an actionable message when the `better-sqlite3` native module fails to load.
  - `board.js`: `waitForEarlyExit()` detects a daemon that dies on boot, so `kj board start` surfaces the real failure instead of reporting a phantom PID.

### Internal

- 5 new unit tests for KJC-BUG-0055: 4 in `tombstones.test.js` (temporal gate revive / no-revive paths + fullScan GC) and 1 in `ephemeral-cleaner.test.js` (tombstone + fs removal on ephemeral cleanup).
- 5 new unit tests for the board-start fix: 3 in `tests/board/board-silent-start.test.js` (`waitForEarlyExit`) and 2 in `packages/hu-board/tests/server-daemon-guard.test.js` (`isDaemonEntryPoint`).

## [2.17.0] - 2026-05-18

Minor release. `kj audit` gains two new deterministic structural collectors (knip dead-exports + madge circular-deps) and the Sonar false-positive filter from v2.16 is generalised to apply across every collector. Engine pin bumped to Node ≥ 20.19 (knip 6.x requirement).

4 872/4 872 tests passing across 402 test files.

### Added

- **KJC-TSK v2.17 — Madge circular-import collector** (#744). New deterministic collector for the `architecture` dimension. Detects circular import chains via madge. Stack-aware: skipped on non-JS/TS projects. Severity heuristic: chain ≥ 4 files = MAJOR, shorter = MINOR. Honours `tsconfig.json` / `jsconfig.json` for path-alias resolution. 60 s timeout. Findings pass through the audit FP filter.
- **KJC-TSK v2.17 — Knip dead-exports collector** (#745). New deterministic collector for the `codeQuality` dimension. Reports unused exports / types (MINOR) and unused files (MAJOR). Stack-aware: skipped on non-JS/TS or missing `package.json`. Invoked as subprocess via `--reporter json`. 120 s timeout. Findings pass through the audit FP filter.
- **Generalised audit FP filter** (#743). Sonar-specific `src/sonar/issue-filter.js` from v2.16.0 moved to `src/audit/issue-filter.js` with a new `tool` field. Every collector — sonar, knip, madge, osv, semgrep — uses the same two mechanisms: static rules in `config.audit.false_positives` and inline marker `// karajan-audit-ignore: <tool>:<ruleId>`. Backwards compatible: compat shim re-exports from the old path, legacy `config.sonar.false_positives` and `// karajan-sonar-ignore: <ruleId>` markers keep working.
- **Built-in FP catalogue** (#746). Four entries shipped by default:
  - `knip:unused-files` in `tests/fixtures/` (loaded by path, not import).
  - `knip:unused-files` in `examples/` (user-facing entry points).
  - `knip:unused-exports` on `index.{js,ts,mjs,cjs,jsx,tsx}` barrels.
  - `madge:circular-import` in `node_modules/` (defensive).

### Changed (BREAKING engines)

- **Node engine: `>=20.10.0` → `>=20.19.0`**. Required by knip 6.x. Same pattern as the v2.8.0 bump (Node 18 → 20.10). Users on Node 20.10–20.18 must upgrade to 20.19+ or 22.12+.

### Internal

- 26 new unit tests (10 madge + 7 knip + 5 cross-tool filter + 4 built-in FP catalogue).
- SEA build: `madge`, `knip`, `oxc-parser`, `oxc-resolver` added to esbuild externals. Collectors degrade gracefully in the SEA binary (`require.resolve` throws → `available:false`); npm installs work normally.
- Dynamic-import budget 160 → 161 (lazy `await import("madge")` in `circular-deps.js`).
- `docs/audit-false-positives.md` extended with config schema, inline marker syntax, built-in catalogue table, and stack-gating table for all 5 collectors.

## [2.16.0] - 2026-05-18

Minor release centrada en calidad: filtro determinístico de falsos positivos Sonar (config + inline ignores), cierre del wire universal de Brain Recovery con el `semantic-detector`, codemod `replace`/g → `replaceAll`/g (41 sitios) y limpieza de hallazgos del propio `kj audit` v2.15.0.

4 846/4 846 tests passing across 401 test files.

### Added

- **KJC-TSK-0416** — Pre-filtro determinístico de falsos positivos Sonar (#741). Antes de mandar issues al coder (rol `sonar-role`) o al auditor, se filtran por:
  1. **Rules estáticas**: `{ rule, filePattern, reason }`. Catálogo built-in (incluye `javascript:S2699` para `tests/architecture/` — fallan vía `expect(offenders, msg).toEqual([])` y Sonar no detecta el assert con mensaje custom). Extensible por proyecto vía `config.sonar.false_positives`.
  2. **Inline ignore**: `// karajan-sonar-ignore: <ruleId>` en la línea del issue (o la anterior) suprime ese hit exacto. Útil para falsos positivos puntuales sin tocar config.
  Issues filtrados quedan registrados con `_suppressedBy` para auditoría. Resultado: el coder deja de quemar tokens "arreglando" cosas que no están rotas.

### Fixed

- **KJC-TSK-0413 step D** — Wire del `semantic-detector` vía adapter a `withBrainRecovery` (#739). El módulo usaba la signature legacy `runTask(prompt, opts)` mientras el wrapper espera `runTask({ prompt, timeoutMs })`. Adapter inline en el módulo. Completa el wire universal de Brain Recovery: ahora **todas** las llamadas IA del pipeline pasan por el clasificador.
- **Codemod `replace` → `replaceAll`** (#738). 41 ocurrencias de `.replace(/regex/g, ...)` migradas a `.replaceAll(/regex/g, ...)` en `src/`. Mismo resultado, semántica explícita (replaceAll exige flag global, `replace(/regex/g, …)` lo hacía por accidente). Detectado por `kj audit` v2.15.0 como hint de modernización ES2024.
- **Audit cleanup BLOCKER false positives** (#740). Refactorizado `expect(offenders, msg).toEqual([])` → `expect(offenders).toEqual([])` con mensaje en variable previa para que Sonar detecte el assert. Reduce BLOCKER count del audit en 11 (todos eran asserts custom con mensaje, no test sin assert real).

### Internal

- `planCommand` alias eliminado → `planGenerateCommand` (16 call sites en tests). Cero alias muertos en superficie pública del CLI.
- Tests Brain Recovery skip-on-fail confirmado en `semantic-detector` (test env: el sleep es no-op, abort viene rápido, best-effort intacto).

## [2.15.0] - 2026-05-17

Minor release. Tres epics completos sumando 30+ commits y ~4 000 LOC: self-healing de plans, model routing per HU con cross-provider review y undo, y un sistema completo de recuperación ante fallos de IA (rate limit, quota daily/monthly, network, silenced) con hibernación persistente y fallback chain.

4 835/4 835 tests passing across 400 test files.

### Added — Epic Brain Recovery (KJC-PCS-0044)

- **KJC-TSK-0411** — Universal agent error classifier (#722). Clasifica cualquier fallo de IA en 7 clases con metadata accionable: RATE_LIMIT_SHORT, QUOTA_EXHAUSTED_DAILY, QUOTA_EXHAUSTED_MONTHLY, API_DOWN, AUTH_FAILED, NETWORK_TIMEOUT, SILENCED, UNKNOWN_FATAL. Parsers per-provider (claude, codex, gemini, opencode).
- **KJC-TSK-0412** — withBrainRecovery wrapper (#724). Política central de retry/standby/backoff/hibernate/abort según clase. Backoff exponencial con jitter, observabilidad vía emitter.
- **KJC-TSK-0413** — Wire universal del wrapper (#726, #727, #728). TODA invocación a agente IA pasa por Brain Recovery. Coverage: plan-reviewer, plan-fixer, tests-synthesizer, planner, coder, reviewer, hu-reviewer, security, audit, refactorer, architect, discover, researcher, triage, solomon, lazy-planner, hu-splitter, kj triage/architect/researcher/discover standalone.
- **KJC-TSK-0414** — Hibernación persistente (#729, #733, #734, #735). standby-store al disco + scheduler event-driven (setTimeout único per session, sin polling). reconcileAll() al arrancar el board. Comandos `kj standby list` + `kj standby resume <id>`. GC extendido limpia standby/done > 7d, audits > 30d, hu-board-runs > 30d. UI board: banner sticky con countdown HH:MM:SS.
- **KJC-TSK-0415** — Plan B fallback chain (#736). Anthropic introduce \$200/mes Agent SDK desde 15-jun-2026 — agotarlo bloquearía runs 30 días. Cuando QUOTA_EXHAUSTED_* con retryAfter > max_wait_hours (default 12h) y hay fallback configurado, Brain switchea al provider alternativo. Recursivo (claude → codex → opencode). Configurable per rol. Wizard `kj init` extendido.

### Added — Epic Model Routing + Undo (KJC-PCS-0043)

- **KJC-TSK-0405** — Model router por HU (#715, #719). Cada HU lleva coder_model + reviewer_model asignados automáticamente según complexity. Reviewer cross-provider del coder por defecto (claude↔codex).
- **KJC-TSK-0406** — Override modelos desde el board (#717). Modal HU expone inputs para overridear coder/reviewer por HU.
- **KJC-TSK-0407** — Sección `model_routing` en config schema (#716).
- **KJC-TSK-0410** — opencode + aider first-class en model-router (#721).
- **KJC-TSK-0408** — Undo per HU con snapshots git (#718, #720). Ref git pre-coder + botón ⏪ Undo en modal → reset --hard → status=pending.

### Added — Epic Self-Healing Plan (KJC-PCS-0042)

- **KJC-BUG-0053** — plan-fixer asigna short_id + blocked_by a HUs añadidas (#707).
- **KJC-BUG-0054** — Convergence guard inteligente (priority vs secondary) (#708).
- **KJC-TSK-0399** — Structural integrity pass post-review (#709). Rompe ciclos (DFS), elimina blocked_by huérfanos, AUTOFIX-NNN para short_id missing.
- **KJC-TSK-0400** — Skip Sonar/TDD/tests en HUs no-code (#710). Nuevos task_types `spike` y `research`. Title prefix [SPIKE]/[DOC]/[RESEARCH] → task_type inferido.
- **KJC-TSK-0401** — Validación estructural en PATCH blocked_by (#711). Rechaza ciclos + refs huérfanas con HTTP 400.
- **KJC-TSK-0402** — `kj plan fix [planId] [--prompt]` (#712). Re-corre reviewer + self-fix + structural pass sobre plan existente.
- **KJC-TSK-0403** — Eliminar columna Failed del board (#713). status/result ortogonal: HUs fallidas vuelven a Pending con badge ✗.
- **KJC-TSK-0404 step 1** — Zombie reaper marca result=fail + blocker (#714).

### Internal

- 4 835/4 835 tests passing (era ~4 700 en v2.14.3). 400 test files.
- 30+ commits desde v2.14.3, todos pasando shrink-budget (≤ 200 LOC neto por PR salvo 4 exclusiones cohesivas con `large-pr-justified`).

## [2.14.3] - 2026-05-13

Patch. Tres mejoras al sistema de preflight detectadas al lanzar el primer `kj run` real sobre un proyecto greenfield (greta-app).

### Fixed

- **KJC-BUG-0049 (fix puntual)** — `preflight` ya no aborta cuando `gh` está autenticado por keyring/OAuth (caso default tras `gh auth login --web`) sin `GH_TOKEN` en env (#690). El check ejecuta `gh auth status` como fallback antes de fallar.

### Added

- **KJC-BUG-0049 (fix arquitectural)** — Sistema de checks **degradables** (#691). Nuevo campo `Check.degradable` con shape `{ disables: ["git.auto_pr", ...], warn: "mensaje" }`. Cuando un check degradable falla, el preflight NO aborta: desactiva los flags listados y emite WARN. La sesión continúa con esas features off. Aplicado a `token:gh`: si `gh` no está auth, se desactivan `auto_pr` + `auto_push` y el coder sigue haciendo commits locales. Reemplaza el patrón "fail-closed" rígido por "degrade-or-fail" según la naturaleza del check.

- **KJC-TSK-0393** — Project-aware preflight (#691). Nuevo módulo `src/checks/project-checks.js` con signal detection + checks dinámicos basados en el proyecto real:
  - **Signals detectados**: `node` (package.json), `docker` (Dockerfile/compose), `firebase` (firebase.json/.firebaserc), `python` (pyproject.toml/requirements.txt/setup.py), `rust` (Cargo.toml), `go` (go.mod), `terraform` (*.tf), `env-example` (.env.example/.sample/.template), `env` (.env).
  - **Checks dinámicos**:
    - `project:kj-init-ran` — avisa si falta config Karajan global Y local
    - `project:write-perms` — verifica permisos de escritura en projectDir + .kj/ + .karajan/
    - `project:tool:<docker|firebase|python3|cargo|go|terraform>` — solo aplica cuando el signal está, comprueba que la tool está instalada con install command ejecutable
    - `project:env-consistency` — lista variables faltantes en .env vs .env.example
    - `project:gh-remote-access` — degradable, ejecuta `git ls-remote --heads origin` para validar acceso al remote real (no solo `gh auth status` global)
  - Integrado en preflight extended phase de `kj run` automáticamente.
  - **Comando nuevo**: `kj doctor --project` ejecuta SOLO esta fase. Útil para validar un proyecto antes de `kj run` sin re-correr todos los checks globales (CLIs, node, sonar, etc.).

### Tests
- 4 nuevos en `runner.test.js` para degradable
- 15 nuevos en `project-checks.test.js`
- Suite total: **4608/4608** verde (+24)

## [2.14.2] - 2026-05-12

Patch release. Dogfooding GRETA Plan 2 v2.14.1 reveló 2 bugs UX + 1 gap de documentación:

### Fixed

- **KJC-BUG-0048** — Botón ▶ Run en cards del HU Board ya no aparece en HUs con `blocked_by` no resueltas (#687). `canRunHu` en `packages/hu-board/public/app.js` solo miraba `status + testCount`; ahora añade `&& blockedBy.length === 0`. Las 19/58 HUs entry-point siguen mostrando ▶; las 39 con deps muestran solo "⏳ waits for: …" hasta que sus deps se certifiquen.

### Added

- **`[EPICA]` prefix** automático en titles del planner (#687). El prompt ahora exige que `description` empiece con `[EPICA] one-sentence description`. El planner extrae las épicas de headings del SPEC (`### Épica NOMBRE`) y prefija cada HU. Fallbacks: `[INFRA]` para setup, `[SHARED]` para cross-cutting. Tras dogfooding GRETA Plan 2: 62/62 HUs con prefix correcto (PROFILE, ASSESS, AI, IMPACT, GUARD, INFRA, CATALOG).
- **`docs/task-templates/spec-conventions.md`** (#688, KJC-TSK-0385). Documento central con las 6 convenciones que el planner v2.14.x entiende: épicas, scope exclusions, deps transversales, reuse, async observers, deps explícitas. Más antipatrones detectados en dogfooding y checklist pre-generación.
- **`plan-generate.md` updated** (#688): banner + 4 secciones 📘 con ejemplos de cada convención.

## [2.14.1] - 2026-05-12

Patch release. Dos patologías del planner descubiertas en dogfooding de GRETA Plan 2 contra v2.14.0:

### Fixed

- **KJC-BUG-0046 (P5)** — Self-fix loop ya no diverge sin convergencia (#684). Dogfooding mostró que el iter 2 del self-fix podía empeorar el plan (iter 1 reducía 15→10 issues, iter 2 subía a 17 al borrar HUs que iter 1 había añadido). Fix: snapshot del plan (deep clone de `plan.hus` + `plan.review`) ANTES de aplicar cada patch del fixer; tras re-review, si `newCount > currentCount`, restaurar snapshot y `break`. Log nuevo: `[planner] self-fix iter N regressed (X → Y) — reverted, stopping`.
- **KJC-BUG-0047 (P6)** — Planner ya no declara `blocked_by` sobre observers asíncronos (#685). Dogfooding mostró que el planner convertía "Y reacciona a X" en `blocked_by`, rompiendo el principio AVISA-no-BLOQUEA: HUs business marcaban como dependencia sus guardarraíles asíncronos. Fix: regla explícita en el prompt listando 6 patrones de async observers (guardrails/validators/monitors, cron jobs, webhooks/listeners, async queues/workers, audit logs/metrics, validators que corren después) + heurística "consume vs react": si X CONSUME un deliverable de Y antes de empezar → `blocked_by`. Si Y solo REACCIONA a X → paralelo, NO `blocked_by`.

### Dogfooding result

Regenerar Plan 2 GRETA con esta release iguala el baseline de v2.13.0 + parches iter 1 (9 findings sobre 58 HUs, 15% issue density) cuando v2.14.0 puro devolvía 17. Reducción del 47% en findings iniciales gracias a P6; P5 evita el regreso en cualquier iter 2.

## [2.14.0] - 2026-05-12

Quality pass — 16 PRs absorbiendo bugs blockers, patologías del planner detectadas durante el dogfooding de Plan 2 GRETA, hardening del HU Board, y la primera tanda de reorganización de tests (issue #368).

### Fixed — bugs blockers

- **KJC-BUG-0026** — Solomon ya no aprueba security blockers legítimos clasificados erróneamente como "style" (#665). Rule 6 (`reviewer_style_block`) ahora detecta security keywords (sql injection, xss, csrf, auth, password, secret, hash, traversal, …), severities altas (critical/high/blocker/major), y categorías security/correctness antes de clasificar como style.
- **KJC-BUG-0032** — Detección de leak filesystem con segunda capa: `detectTranscriptCdLeaks()` escanea el transcript del coder buscando `cd <abs-out-of-project> && <write-cmd>` (mkdir/touch/git init/pnpm init/echo >/...) que la snapshot-diff anterior no capturaba si el target ya existía (#666).
- **KJC-BUG-0035** — Sonar admin password rotation ya no falla silenciosamente: si `change_password` devuelve 403/500/400-sin-error-default/network error, `passwordRotationError` se propaga al caller y `kj init` lo logue como WARNING con instrucciones para rotar a mano (#672).

### Fixed — patologías del planner (P1-P4)

Detectadas en el dogfooding de Plan 2 GRETA (2026-05-11), donde el reviewer flagaba 4 huecos del SPEC en cada iteración:

- **P1 / KJC-BUG-0042** — Planner respeta exclusiones explícitas del scope (#667). `extractScopeExclusions(task)` detecta 6 patrones (ES + EN): "NO incluye en este plan: X, Y", "Out of scope: X", "Plan N handles: X", … y los renderiza como sección **FORBIDDEN scope** en el prompt.
- **P2 / KJC-BUG-0043** — Planner declara deps a TODOS los miembros de una categoría transversal (#668). Si una HU tiene AC tipo "listado transversal de warnings filtrables por guardrail", la dep es a `GUARD-001..N`, no solo a `GUARD-001`.
- **P3 / KJC-BUG-0044** — Nuevo campo `reuse` en step schema (#669). Si la funcionalidad ya está cubierta por otra HU, declara `reuse: ["<id>"]` en lugar de reimplementar. Wiring completo end-to-end: prompt, plan-hu-ops (addHu/removeHu/updateHu), generate.js.
- **P4 / KJC-BUG-0045** — Reviewer self-fix loop tras la primera review (#670 + #671). Nuevo módulo `src/plan/plan-fixer.js` con `applyReviewerFeedback` que pide al planner un patch estructurado (`additions`/`deps_to_add`/`deletions`) y `applyFixerPatch` que lo aplica in-place. Loop max=2 iter o hasta 0 findings. Skippable con `--no-plan-fixer`/`--quick`.

### Fixed — HU Board polish

- **KJC-BUG-0038** — Prompts zombi de runners crashed se limpian solos. `GET /api/prompts` aplica TTL 30 min sobre `createdAt` (fallback a `mtime`); más viejo → unlink + tombstone + skip (#673). Cubre Solomon escalations legítimamente largas pero no deja la UI bloqueada por archivos huérfanos.
- **KJC-BUG-0039** — Rate-limit menos agresivo y SSE exento (#674). Default 300→600 req/min, env var `HU_BOARD_RATE_LIMIT` para override, `skip:` para `/api/events` (SSE persistente + reconnects automáticos del browser no deberían contar contra el budget).

### Closed without code change

- **KJC-BUG-0027** — Scope guard `max_files_per_iteration` ya fue retirado en v2.0.0 (PR #357 / commit 906a4273). Coder prompt ahora enforce atomic commits sin guard hard-coded por número de archivos. Card movida a Closed con commits + rootCause + resolution.

### Refactor — tests folder reorganization (issue #368, parcial)

5 PRs movieron ~93 archivos `*.test.js` de `tests/` root a subcarpetas espejo de `src/`:

- #675 `tests/plan/` (14 archivos)
- #676 `tests/hu/` (7 archivos)
- #677 `tests/sonar/` (14 archivos)
- #678 `tests/board/`, `tests/session/`, `tests/triage/`, `tests/domain/` (23 archivos)
- #679 `tests/agents/`, `tests/brain/`, `tests/reviewer/`, `tests/security/`, `tests/utils/`, `tests/coder/`, `tests/solomon/`, `tests/skills/`, `tests/roles/` (35 archivos)

Cambios puramente mecánicos: `git mv` + sed para 6 patrones de imports (`from`, `vi.mock`, `vi.doMock`, `import()`, `./fixtures`, `import.meta.dirname` patterns). Quedan ~170 archivos en root para próximas oleadas.

### Tests

Suite de 4577 tests verde durante toda la sesión. 16 PRs mergeadas, **0 regresiones**.

## [2.13.0] - 2026-05-11

Minor release. **HU Board hardening pass.** Cinco PRs centradas en
hacer el board resiliente y autoreparable tras la sesión de
dogfooding del 2026-05-10 que reveló cuatro patologías acumuladas
(modal "Karajan needs an answer" zombi del 7 de mayo bloqueando
toda la UI, 18 proyectos zombi reapareciendo tras cada `kj board
start`, cache HTTP del navegador sirviendo HTML/JS antiguos tras
restart del server, modal con fondo transparente porque
`var(--bg-secondary)` nunca estaba declarada). Cero parches sueltos
— refactor estructural por causa raíz.

### Added

- **Tombstones — delete persistente que sobrevive a fullScan**
  (`KJC-TSK-0380`, #655/#656/#657). El board reconstruía la DB
  SQLite desde el filesystem en cada sync y revertía silenciosamente
  cualquier delete por API. Solución: tabla `tombstones (resource_type,
  resource_id, deleted_at, source, fs_paths)` que registra los ids
  que el usuario enterró; los syncs consultan la tombstone ANTES de
  upsert y, si está, hacen `rm -rf` del path del filesystem y
  abortan. Patrón clásico de Cassandra/Riak. Permanentes por diseño,
  restauración explícita vía endpoint.
- **Endpoints DELETE reforzados + nuevos** — `/api/projects/:id`,
  `/api/stories/:id`, `/api/sessions/:id` ahora tombstone + `rm -rf`
  del fs path correspondiente. Nuevos: `/api/prompts/:id`,
  `/api/plans/:planId`, `GET /api/tombstones`,
  `POST /api/tombstones/:type/:id/restore`.
- **Nuevo comando `kj board cleanup`** (`KJC-TSK-0380` PR-C, #657)
  detecta y borra: proyectos efímeros (`tmp_*`/`test_*`/`demo_*`/
  `kj-test-*`/`s_*`/`plan-*` con >7d sin actividad), prompts
  huérfanos (sin `.answer.json` y mtime >24h), directorios de
  sesión huérfanos. Soporta `--dry-run`. Resuelve los ~20 zombis
  acumulados en una pasada.
- **Server-restart detector + `/api/version`** (`KJC-TSK-0379`,
  #654). El cliente polea `/api/version` cada 30s; si `boot_time`
  cambia (server reiniciado), `forceRefresh()` automático: limpia
  caches y recarga. El usuario ya no tiene que cerrar pestañas o
  hacer Clear Site Data tras un `kj board stop` + `kj board start`.
- **Botón 🧹 manual** en el header del HU Board (escotilla manual
  para los casos en que el polling todavía no ha disparado pero algo
  visualmente no cuadra).

### Changed

- **`Cache-Control: no-store, must-revalidate`** para HTML/JS/CSS
  servidos por el board (#654). ETag + Last-Modified desactivados.
  Garantiza que el primer request tras un restart trae el código
  nuevo, sin revalidación condicional que el navegador pueda
  saltarse.
- **HU Board v2.10 rate-limit** documentado como problema en
  `KJC-BUG-0039` (no fix en este release; aterrizará después).

### Fixed

- **Modal del prompt transparente** (#658). `var(--bg-secondary)`
  estaba referenciada en 8 sitios de `app.js` (modal, textareas,
  inputs) pero nunca declarada en `:root` → fallback a `transparent`
  → cards visibles detrás del modal. Fix: declarar la variable en
  `:root` con `#131a30`. Una línea CSS, ocho consumidores corregidos.
- **Empty-state del HU Board mostraba ☐** (cuadrado vacío Unicode
  U+2610) sin estilo coherente (#658). Eliminado del template; el
  title + text + path son suficientes para transmitir "no hay nada".
- **Causa raíz de modales zombi** (`KJC-BUG-0038`) absorbida por el
  refactor de tombstones — ya no hay forma de que un prompt huérfano
  bloquee la UI.

### Documentation

- **Glosario de tombstones** implícito en CHANGELOG y comentarios
  inline. Patrón explicado en cada writer/reader que lo consulta.



Minor release. Two new quality-measurement features land together: a
per-run **plan adherence** score and a **golden-tasks** regression suite
for cross-version output-quality detection. Plus a CI policy refinement
that frees documentation from the LOC budget while keeping AI-rule
files (CLAUDE.md, AGENTS.md, role prompts) capped.

### Added

- **Plan adherence metric** (`KJC-TSK-0376`, #645/#646) — every `kj run`
  that executes against a known plan now computes a deterministic 0–100
  score in `summary.md` answering *"did the coder follow the plan?"*.
  Four weighted components (commit attribution 40%, acceptance tests
  30%, scope discipline 20%, dependency order 10%) reported in a
  breakdown table. Pure offline calculation — no LLM, no extra cost.
  Spec in `docs/plan-adherence.md`. Inspired by deepeval, kept fully
  deterministic for reproducibility (golden-task suite friendly).

- **Golden tasks regression suite** (`KJC-TSK-0374`, #648/#650/#651) —
  a small set of canonical tasks (`todo-rest-api`, `npm-package-cli`,
  `react-counter-component`) executed before every release to detect
  output-quality regressions between Karajan versions. Five assertion
  families per task: commits-min, audit status, plan adherence,
  expected test files, allowed LOC range. All deterministic — no LLM
  judge. Library-only in this release; CLI integration is a follow-up
  task. Spec in `docs/golden-tasks.md`.

### Changed

- **Shrink-budget gate refined** (#649) — `*.md` files used to count
  toward the 200-LOC PR limit, which forced trimming of legitimate
  documentation. Human-facing docs (`docs/**`, `CHANGELOG.md`,
  `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATION*.md`,
  `TODO*.md`) are now excluded. AI-rule files (`CLAUDE.md`,
  `AGENTS.md`, `templates/**/*.md` — role prompts, coder/review rules)
  still count, since unbounded growth there dilutes the agent's
  context.

### Documentation

- **Plan adherence spec** (`docs/plan-adherence.md`) — full reference
  for the new metric: components, attribution rules, output shape,
  when the section is omitted, why no LLM judge.

- **Golden tasks spec** (`docs/golden-tasks.md`) — full reference for
  the regression suite: how it works, the 3 tasks, schema, baseline
  format, when the suite runs.

- **Audit false positives registry** (`KJC-TSK-0353`, #578) — new
  `docs/audit-false-positives.md` recording the 4 dependencies that
  `kj audit` flags as unused but are actually used via indirect
  mechanisms (config files, hooks, `npx` from scripts): `@changesets/cli`,
  `@vitest/coverage-v8`, `postject`, `simple-git-hooks`. Future audits
  skip the same investigation. Re-confirmed live in N8 audit
  (2026-05-07). No code or dependency changes.

## [2.11.0] - 2026-05-08

Minor release. Two-day dogfooding pass (10-level test plan) surfaced and
fixed a long tail of UX papercuts, two latent zombi-status bugs, and the
HU sub-pipeline branch-creation regression on fresh repos. All N0–N8
levels are now re-validated green; N9 is the human rehearsal step. Two
small `hu-board` features land alongside the fixes: an automatic cleanup
of ephemeral test projects at boot and an in-UI help modal + tooltips
for the five header views.

### Added — `hu-board`

- **Auto-cleanup of ephemeral test projects** (`KJC-TSK-0371`, #627). On board
  start, any project whose id matches `/^(tmp_|test_|demo_|kj-test-)/i`
  AND has been inactive for >24h is cascade-deleted (project + stories +
  sessions). A new `is_test` column on `projects` lets the user override
  per-project: `1` forces ephemeral, `0` pins forever, `null` follows the
  default heuristic. New `PATCH /api/projects/:id/is-test` endpoint and
  a 3-state toggle button on each project card.
- **In-UI help and tab tooltips** (`KJC-TSK-0372`, #628). New `?` button
  in the header opens a modal explaining each of the five views. Every
  nav tab carries a native `title` attribute for the standard hover
  tooltip.

### Fixed — pipeline reliability

- **Session-level status zombi** (`KJC-BUG-0037`, #635). Several `runFlow`
  exit paths returned `{approved: true}` upstream without sealing
  `session.status`, leaving runs at `running` indefinitely. New boundary
  guard `sealSessionStatusIfStillRunning` at the runFlow return points
  maps the result shape to the terminal status (`approved` / `paused` /
  `cancelled` / `failed`); idempotent + never-throws.
- **`SonarStage` no longer loops on remoteless repos** (`KJC-TSK-0373`,
  #624 + #633). The audit collector skipped Sonar cleanly when no git
  remote was configured, but the run-loop SonarStage hit the same
  scanner code path and threw `Missing git remote.origin.url` on every
  iteration — Brain exhausted `max_iterations` and finalised via the
  "approved-by-exhaustion" fallback without ever running Sonar. New
  shared `canResolveSonarProjectKey` predicate skips the stage cleanly.
- **`commitAll` race tolerance** (#633). Post-loop sometimes saw
  `hasChanges()` return true after `git add -A` but `git commit` then
  refused with locale-specific "nothing to commit" / "nada para hacer
  commit". The thrown error escalated to Solomon and the journal writer
  was skipped. `commitAll` now matches en/es/de/fr "nothing to commit"
  and returns `{committed: false}` cleanly.
- **HU branch fallback when `main` doesn't exist** (#636). `git init -q`
  on a fresh `/tmp/...` repo with `init.defaultBranch=master` produced
  7 identical "branch 'main' is not a commit" warnings during N6 plan
  flow, and every HU silently fell back to the original branch. New
  `resolveExistingBranchRef` probes the configured base, then `main`,
  `master`, `HEAD`; uses the first ref that exists.
- **`writeConfig` strips runtime-only keys** (`KJC-BUG-0036`, #629).
  The loader synthesised `_deprecated.sonarqubeEnabledKey` and the
  wizard used `sonarqube.enabled` as a transient hint, but
  `writeConfig` serialised both — fossilising the deprecation warning
  on disk. New `stripRuntimeOnlyKeys` removes both before serialisation.
- **`addyosmani-catalog` recovers from upstream force-push**
  (`KJC-BUG-0033`, #625). When the cached catalog's upstream rewrites
  history, `git pull --ff-only` fails permanently. New fallback runs
  `git fetch --depth 1 origin HEAD` + `git reset --hard FETCH_HEAD`.
- **`kj init` no longer writes deprecated `sonarqube.enabled`**
  (`KJC-BUG-0034`, #626). Wizard answer survived in memory as a hint
  for `setupSonarQube`, but the persisted YAML now drops the key.

### Fixed — UX / display

- **Sonar `SKIPPED` renders gray, not red, in the result banner** (#634).
  Pre-fix, every non-OK gateStatus painted red, so a clean run with a
  legitimate `SKIPPED` looked like a failure. Three buckets now: `OK`
  → green, `SKIPPED` / `PENDING` → gray, anything else → red.
- **Result panel + summary list every commit the run produced**
  (`KJC-TSK-0373` follow-up, #632). `gitResult.commits` only carried
  the post-loop scaffold commit; the coder's commits had no journal
  owner. New `listCommitsBetween(fromSha)` helper queries git directly.
  New `session.head_at_start` field captures actual HEAD at run start
  (separate from `base_ref` which can be the empty-tree SHA on
  single-commit repos).
- **Help text says `task` is REQUIRED** (#631). 8 commands (`kj run`,
  `kj code`, `kj review`, `kj plan generate`, `kj triage`,
  `kj researcher`, `kj architect`, `kj discover`) advertised the
  positional as `[task]` (commander's "optional" syntax) but the
  runtime requires either the positional or `--task-file`. Description
  updated to "Task description (REQUIRED — provide as argument or via
  --task-file)". `kj audit` is intentionally untouched.

### Documentation

- **`docs/dogfooding-levels.md`** (#630, #637). New 10-level test plan
  reconstructed from the JSONL transcript after a context compaction.
  Each level has a Histórico / Re-validado entry from the 2026-05-07
  dogfooding pass.

## [2.10.2] - 2026-05-07

Patch release. Pure UX improvement on `kj init`: the wizard goes from
9 prompts (covering ~30% of the meaningful runtime knobs) to a full
setup that lets the user pick a CLI per role, auto-generates the
SonarQube analysis token via REST API, and exposes the git automation
+ HU Board security flags. No API changes; safe upgrade from 2.10.1.

### Added — `kj init` wizard expansion (`KJC-TSK-0367`, #616)

- **Per-role provider selection**. For each of `planner`, `researcher`,
  `architect`, `refactorer`, `tester`, `security`, `solomon`,
  `impeccable`, `perf`, `hu_reviewer`: choose **inherit from
  coder/reviewer** (default), **pick a specific CLI**
  (claude/codex/gemini/opencode/...), or **disable the role** when
  allowed. Defensive: initialises missing role/pipeline entries on
  configs coming from older versions, so re-running on an upgraded
  install never crashes.
- **SonarQube token bootstrap**
  (`src/sonar/token-bootstrap.js`, NEW). After the Docker container
  is up:
  1. Probes `admin/admin` via `/api/authentication/validate`.
  2. **Rotates the default password** to a fresh 32-byte secret
     persisted at `~/.karajan/sonar.admin-password` (mode 0600).
     Removes the well-known credentials surface from the user's
     machine.
  3. Revokes any pre-existing `karajan-cli` token (idempotent
     re-runs).
  4. Generates a fresh `GLOBAL_ANALYSIS_TOKEN` via
     `POST /api/user_tokens/generate`.
  5. Persists at `~/.karajan/sonar.token` (mode 0600) **and**
     writes it into `config.sonarqube.token`.
  6. On any failure (401, network, etc.) returns `ok: false` and
     the wizard falls back to the manual instructions that existed
     before this card.
- **Git automation prompts**: `auto_commit`, `auto_push`, `auto_pr`
  booleans. `branch_prefix` asked only when `auto_commit` is on
  (default `feat/`).
- **HU Board security prompts** (only when HU Board is enabled):
  bind host (`127.0.0.1` default | `0.0.0.0` with auto-generated
  token enforced for non-loopback peers) and port.

### Tests

- `tests/init-wizard.test.js` extended:
  - Existing happy-path test updated to expect **15** `wizard.select`
    calls (2 agents + 10 per-role + 3 lang/methodology) instead of
    the pre-fix 5.
  - **4 new direct unit tests** for `askPerRoleProviders`.
  - **3 new tests** for `askGitAutomation`.
  - **4 new tests** for `askBoardSecurity`.
- `tests/sonar-token-bootstrap.test.js` (NEW, 5 tests): success path,
  admin/admin login fails, network error, password rotation rejected,
  token generation failure.
- Internal `__test__` named export on `init.js` so the sub-functions
  are testable without driving the whole `initCommand` pipeline.

**4 375 / 4 375** passing across 374 test files (was 4 359; +16 new).

### Documentation

- `docs/agents/SKILL.kj-init.md` updated to describe the 8 sections
  of the new wizard.

### Out of scope (deferred)

- Wizard reentrante (`kj init --role coder --change`).
- Stack-driven defaults (frontend project → impeccable on by default).
- SonarCloud token bootstrap (only the local container is covered).

## [2.10.1] - 2026-05-06

Patch release. One-line fix for a stdout contamination bug in
`kj audit --agent-readiness --json`, plus polish in the asciinema demo
scripts under `docs/demos/`. No API changes; safe upgrade from 2.10.0.

### Fixed

- **`kj audit --agent-readiness --json` no longer contaminates stdout
  with the `[info]` banner** (PR #613). Pre-fix, piping the JSON output
  into `jq` (e.g. `kj audit --agent-readiness --json | jq '.score'`)
  failed with a parse error because the logger emitted
  `Auditing agent-readiness of <path>` to stdout BEFORE the JSON
  document. The fix is a one-line guard in `src/commands/audit.js` that
  suppresses the banner whenever `--json` is set. Regression pin in
  `tests/e2e/07-kj-audit.test.js` asserts `r.stdout` starts with `{`
  and parses with `JSON.parse()` without preprocessing.

### Changed — demo scripts (`docs/demos/`)

- `agent-readiness.txt`: replace the `~/some-third-party-repo`
  placeholder with a concrete recommendation (clone `expressjs/express`
  — no llms.txt → low score → contrast vs Karajan's 100/100).
- `happy-path.txt`:
  - Realistic timing (~5–10 min, not ~3 — asciinema's idle-time
    collapse doesn't apply to a live audience).
  - Add `--auto-commit` to the hero `kj run` so commits actually
    appear in `git log`.
  - `npm install --silent` before `npm test` (safety net — coder may
    not run install on its own).
  - Drop `--dimensions architecture` from the closing audit (no-op
    when combined with `--deterministic-only`).
  - Replace `cat package.json | head -15` with `head -15 package.json`.

### Added

- **Pre-talk code review backlog** — 3 Sonnet agents in parallel
  surfaced P1/P2 latent bugs and test gaps. None affect the live
  demo on 2026-05-21; all deferred to post-talk. (Backlog lives
  in the maintainer's private notes, not in this repo.)

### Tests

- 4 359 / 4 359 passing (was 4 358; +1 regression test for the
  showstopper).

## [2.10.0] - 2026-05-05

Agent-readiness release — Karajan becomes the first orchestrator with a
full agent-readability surface (llms.txt + a SKILL.md per CLI command +
a static auditor that scores any third-party repo for the same shape).
Plus a webperf quality gate inside the iteration loop, hu-board security
hardening, and a skills mapper that auto-pulls WCAG context for a11y
tasks. Five PRs merged. Zero breaking changes; opt-in flags throughout.

### Added — agent-readiness surface

- **`kj audit --agent-readiness`** (`KJC-TSK-0350`, #609). Static, LLM-
  free score for any repo against seven checks: llms.txt presence,
  llms.txt validity (sections + links), robots.txt AI-bot allowlist,
  per-doc token budget (≤ 32 KB), heading hierarchy, agents/README.md
  entry point, SKILL.md coverage. Output: 0–100 score, per-check ✓/✗,
  ranked top-fixes list. `--json` for CI; pure data transformation
  (no network, no LLM, no side effects). Two detector bug fixes that
  brought Karajan-on-Karajan from 80 → 100/100: bash comments inside
  fenced code blocks no longer count as H1, and `<h1 align="center">`
  HTML banners are now recognised as valid H1s.
- **SKILL.md per CLI subcommand** (`KJC-TSK-0349`, #608). Six new
  `docs/agents/SKILL.kj-{doctor,init,board,review,resume,clean}.md`
  files, all following the established contract (What it does ·
  Inputs · Outputs · Constraints · Side effects · Common failure
  modes · Example · Related). Architectural test
  `tests/architecture/agent-readability.test.js` fails CI when a
  SKILL link in `llms.txt` no longer resolves or a SKILL.md drops a
  required section.
- **`docs/demos/`** (`KJC-TSK-0228`, #610). Three asciinema recording
  scripts (happy-path, agent-readiness, audit-with-llm) plus a README
  with terminal config, pre-recording checklist, embedding via
  `<asciinema-player>`, and a re-record cadence. Source-of-truth
  approach: scripts in repo, .cast files re-recorded per release.
- **`robots.txt`** at repo root. Explicit `Allow: /` for GPTBot,
  ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, CCBot.

### Added — webperf quality gate

- **`PerfStage` in iteration loop** (`KJC-TSK-0151`, #605). Wires
  `PerfRole` (#603) into `runQualityGateStages` after Impeccable when
  `pipeline.perf.enabled` is `true`. PASS verdict → iteration
  continues; FAIL verdict → reviewer feedback with concrete blocking
  metrics + top opportunities, iteration retries; scanner unavailable
  → log warn and skip (best-effort, never blocks the pipeline by
  itself). CLI/MCP parity: `--enable-perf` flag + matching
  `enablePerf` in `mcp/tools.js`, `mcp/run-kj.js`, sovereignty-guard
  allowlist, and `applySessionOverrides`. Default OFF.

### Added — skills mapper

- **a11y/WCAG/ARIA pattern in `TASK_PATTERN_TO_SLUG`**
  (`KJC-TSK-0351`, #606). Tasks mentioning accessibility / a11y /
  WCAG / ARIA / screen reader / keyboard navigation auto-pull the
  `frontend-ui-engineering` skill — until the upstream addyosmani
  catalog ships a dedicated a11y skill, that's the closest
  authoritative source for WCAG-aware UI work. 8 new positive task-
  text tests + 1 negative + 1 dedup guard.

### Changed — hu-board security hardening

- **Bind 127.0.0.1 by default** (`KJC-TSK-0355`, #607). Was binding
  all interfaces — fine on a personal laptop, problematic on shared
  WiFi with auto-discovery. New `kj board start --bind <host>` flag
  for the explicit \"expose on LAN\" case; banner emits a warning +
  token URL when binding non-loopback.
- **Auto-token, opt-in enforcement**. Token auto-generated at
  `~/.karajan/hu-board/token` (mode 0600, 32 random bytes hex,
  idempotent). Auth middleware only enforces the token for non-
  loopback peers — same-machine browser keeps working without
  `?token=` on every link. Three accepted carriers: `Authorization:
  Bearer`, `?token=`, `kj_board_token` cookie.
- **`helmet` middleware**: X-Content-Type-Options, X-Frame-Options,
  conservative CSP (allows inline scripts/styles for the existing
  dashboard), removes `X-Powered-By: Express`.
- **`express-rate-limit`** on `/api`: 300 req/min per IP, draft-7
  `RateLimit-*` headers.

### Tests

- Full suite: **4358/4358** passing (373 files), up from 4305 in v2.9.
- New: `tests/webperf/perf-stage.test.js` (5), bash-comment + HTML
  H1 regression tests in `tests/audit/agent-readiness.test.js` (12
  total), `tests/architecture/agent-readability.test.js` (4),
  `tests/skills/addyosmani-role-map.test.js` extended (28 total),
  `packages/hu-board/tests/{auth,security-middleware,token-store}.test.js`
  (175 total in the hu-board package).
- New `dynamic-imports.test.js` budget bump (159 → 160) for
  `PerfStage`'s feature-flag-gated brain-coordinator import.

### PRs merged in this cycle

| # | Card | Description |
|---|---|---|
| #605 | KJC-TSK-0151 | PerfStage + pipeline integration |
| #606 | KJC-TSK-0351 | a11y/WCAG/ARIA skills pattern |
| #607 | KJC-TSK-0355 | hu-board security hardening |
| #608 | KJC-TSK-0349 | SKILL.md per kj subcommand + coverage guard |
| #609 | KJC-TSK-0350 | --agent-readiness false-positives + 100/100 |

## [2.9.0] - 2026-05-04

Audit overhaul release — `kj audit` becomes a stack-aware, two-phase
analysis tool with deterministic security collectors (Sonar + OSV +
Semgrep), dimension auto-activation per project type, persistable
reports, token/cost transparency, and an interactive prompt that lets
the user inspect deterministic findings before paying for the LLM
phase. 13 PRs merged + 5-PR refactor (228 → 3 dead exports) +
detector false-positive cleanup. Zero breaking changes for MCP/pipeline
callers (the legacy `AuditRole.execute()` still chains both phases).

### Added — `kj audit` overhaul

- **Two-phase mode** (`KJC-TSK-0364`, #597). Deterministic findings
  print first; `Continue with LLM analysis? [y/N]` prompt before
  spending tokens. New `--deterministic-only` (zero-token mode) and
  `-y`/`--yes` (auto-confirm). CI/non-TTY paths auto-confirm. `--json`
  bypasses the prompt to keep stdout pipeable.
- **Project stack detection** in prompt (`KJC-TSK-0358`, #586). New
  `## Project Stack` section tells the LLM to filter heuristics by
  tier — frontend-only projects don't get N+1 query nags, backend-only
  projects don't get bundle-size nags, fullstack projects get both.
- **Accessibility dimension** (`KJC-TSK-0359`, #593). New WCAG 2.x
  audit auto-activated for frontend / fullstack / unknown stack;
  auto-skipped for backend-only (override with `--dimensions=accessibility`).
  Static checks for missing alt text, label-less inputs, heading
  hierarchy gaps, icon-only buttons without aria-label, ARIA misuse,
  focus management, colour-only signalling. Defers runtime contrast
  to axe-core/Lighthouse.
- **WebPerf section** (`KJC-TSK-0360`, #594). Frontend-perf hints
  (render-blocking, lazy loading, image format, CLS, font-display,
  critical CSS, third-party script facade pattern) when no live CWV
  measurement is available; renders the Core Web Vitals verdict when
  `config.webperf.lastResult` is present.
- **SonarQube findings** as deterministic prompt input (`KJC-TSK-0361`,
  #588). New `## SonarQube Findings` section with rule IDs + line
  precision; the LLM cross-references its own findings instead of
  guessing. `--no-sonar` to skip. Capped at 50 entries.
- **OSV-Scanner integration** (`KJC-TSK-0365`, #598). Best-effort
  collector that wraps `osv-scanner` for dependency vulnerability
  findings (broader DB than `npm audit`: GitHub Advisory Database +
  GLSA + Go vuln DB + others). Auto-skipped when not installed.
  Findings fold into the `security` dimension with CVE/GHSA as the
  rule. `--no-osv` flag.
- **Semgrep SAST integration** (`KJC-TSK-0366`, #600). Best-effort
  collector for static analysis findings (SQL/Cmd injection, XSS,
  hardcoded secrets, taint flow, language-specific anti-patterns).
  2000+ built-in rules via `--config auto`. CWE + OWASP metadata
  preserved. `--no-semgrep` flag.
- **Token/cost summary** (`KJC-TSK-0363`, #595). Every audit ends
  with `## LLM Usage` section: provider + model + duration + tokens
  + estimated cost in USD. Surfaces in stdout (markdown), `--json`
  output (top-level `usage` key), and persisted reports.
- **`--report-file` flag** (`KJC-TSK-0362`, #592). Persists the audit
  on disk in addition to stdout. Path is a file (extension drives
  format `.md` or `.json`) or a directory (auto-creates
  `audit-<ISO>.<md|json>`). `$KJ_AUDIT_REPORT_DIR` env var as default.
  Markdown reports get a reproducibility header (timestamp, project
  dir, branch + commit, invocation flags).

### Changed — `kj audit` parity bug fix

- **CLI now drives `AuditRole`** (`KJC-TSK-0357`, #585). Pre-patch the
  CLI re-implemented `createAgent + buildAuditPrompt + parseAuditOutput`
  inline, silently dropping the deterministic `basalCost`/`growthDelta`
  inputs that `AuditRole.execute()` collects when invoked via MCP.
  Same code path now means same prompt content for CLI and MCP.

### Fixed — `kj audit` detector accuracy

- **`findDeadExports` false positives reduced 166 → 4** (`KJC-TSK-0356`,
  #584). The `kj audit` detector now understands `@internal` JSDoc,
  `await import("path")`, `import * as ns from "..."`, and
  `export { x } from "y"` re-exports. Strings (template, double, single)
  are stripped before export-detection regexes so embedded sample
  source in test fixtures no longer pollutes findings. Result drops
  from 55x to 1.3x noise vs knip ground truth.

### Fixed — repo health (228 dead exports cleanup)

- **228 dead exports → 3** across `src/checks/`, `packages/hu-board/`,
  `src/orchestrator/`, `tests/fixtures/`, and the rest of `src/`.
  Splits across 5 atomic PRs (`KJC-TSK-0354 A-E`, #579-#583) so each
  bisect-friendly. Mix of demote-to-private (most), entirely-dead
  removal (a handful), and `@internal` JSDoc documentation for the
  6 helpers tests reach via dynamic import. Knip baseline drops from
  228 → 3.

### Test plan

Full suite **4305/4305 passing** (was 4199 at the start of the
release). 106 new tests added across 11 new test files in
`tests/audit/` plus targeted updates to `tests/command-audit.test.js`.

## [2.8.0] - 2026-04-30

Audit-driven hardening release. The 2026-04-30 self-audit (`kj audit`)
flagged 13 issues across security, code quality, performance, architecture,
and testing. This release closes all 13 plus several follow-ups surfaced
during the cleanup. 16 PRs merged, 0 user-visible API changes.

### Changed (BREAKING — runtime floor)

- **`engines.node` bumped from `>=18.0.0` → `>=20.10.0`** (PR #563). Node 18 LTS reached EOL on 2025-04-30; the codebase had been using ESM TLA, AbortController, fetch, structuredClone (all 18+), but the bump unlocks newer JS patterns and matches what CI was already running (vitest 4 / rolldown require Node 20.12+). CI matrix dropped Node 18 too.

### Added

- **FASE 1 e2e suite** (PR #570). 7 scenarios mapped to the 5-bug class from the 2026-04-27 demo regression: `01-plan-generate`, `02-run-plan-happy`, `03-run-single-hu` (zombie-HU), `04-reviewer-rejected` (saveSession-missing), `05-sonar-config-error` (Repairer unfixable), `06-dead-process` (zombi-status), `07-kj-audit`. Plus `tests/e2e/fixtures/fake-coder.js` and `fake-sonar-server.js` infrastructure so each test runs in <90s with no real LLM/network. Total e2e: 23 tests in 6s.
- **Per-directory coverage thresholds** in `vitest.config.js` (PR #566). Opt-in via `--coverage`: `src/agents/**` ≥80%, `src/mcp/handlers/**` ≥80%, `src/session/journal/**` ≥70%.
- **Node subpath imports map** in package.json (PR #565): `#utils/*`, `#session/*`, `#hu/*`, `#skills/*`. Eliminates `../../../` chains in orchestrator phase modules.

### Changed

- **`src/cli.js` split** from 699 LOC into 6 register modules (PR #567): `register-pipeline.js`, `register-plan.js`, `register-meta.js`, `register-roles-skills.js`, `register-sonar.js`, plus `_shared.js`. Entry point now 113 LOC. No CLI surface change.
- **`src/commands/plan.js` split** from 549 LOC into one file per sub-command under `src/commands/plan/` (PR #568). `plan.js` is a 14-LOC re-export shim; the 11 external callers don't change.
- **`src/orchestrator/drivers/iteration-loop.js` split** from 513 LOC → 311 LOC (PR #569). Five phase implementations moved to `iteration-phases/`: coder-and-refactorer, guards, quality-gates, reviewer-gate, handle-approved. Mirrors the established `pre-loop-phases/` pattern.
- **`src/orchestrator/drivers/pre-loop.js` split completed** (PR #560). Driver dropped 626 → 435 LOC by moving `emitConfigDeprecations`, `ensureAddyosmaniSkills`, and `maybeGenerateAutoHuBatch` into `pre-loop-phases/`.

### Fixed (security)

- **`execSync` / `execaCommand` → `execFileSync` / `execa` with arg arrays** (PRs #555 and #562). Closed 7 call sites where the legacy APIs accepted template strings with interpolated values. `baseRef` (session state) and similar inputs are no longer in shell-injection-vector shape. Sites: `verification-gate.js`, `derive-project-name-from-cwd.js`, `direct-actions.js`, `solomon-rules.js`, `cli.js`, `config-init.js`, `init-context.js`. After this batch, every child_process call in `src/` uses tokenised arg arrays.
- **`src/utils/task-file.js` re-throw without `cause`** (PR #563). Error chain was broken; wrapped with `{ cause: err }`.

### Fixed (correctness / quality)

- **57 ESLint warnings closed in src/** (PR #564). 44 `no-unused-vars` (orphan imports, dead code, args renamed to `_arg`), 10 `no-useless-assignment` (dead `let foo = init` + try/catch reset patterns), 4 `preserve-caught-error` (re-throws now preserve `cause`).
- **`activity-log.test.js` fixed-50ms sleeps replaced with `vi.waitFor`** (PR #561). Eliminates a CI flake class without changing assertions.
- **`adr-loader.js` and `garbage-collector.js` parallelised** (PR #558). Independent for-of+await loops now use `Promise.all(map(...))`. ADR loads drop ~5× FS round-trips → 1 burst; GC subroutines run concurrently across disjoint subtrees of `KJ_HOME`/`KARAJAN_HOME`.

### Infrastructure (lint hardening — defensive)

- **ESLint baseline extended to `tests/`** (PR #556). The same three "bug-killer" rules that protect `src/` (`no-undef`, `import-x/no-unresolved`, `import-x/named`) now apply to tests too. Surfaced and fixed 3 latent test bugs: literal multi-space regex, re-throw without cause, unsafe optional chaining.
- **`globalThis.__KJ_*` banned outside `src/config/test-harness.js`** (PR #557) via `no-restricted-syntax`. Stops the regression class where production code reaches into test-only override globals.
- **`no-console: error` outside CLI/display/logger paths** (PR #559). The 309 existing console.* calls were reviewed and all are justified (CLI commands, banners, structured logger). The rule prevents future debug prints from sneaking into the library layer.
- **ESLint warnings ratcheted to errors** (PR #564) for `no-unused-vars`, `no-useless-assignment`, `no-useless-escape`, `preserve-caught-error` in `src/`. Tests/ stays at `warn`.
- **Telemetry silent failures surface under `KJ_DEBUG=1`** (PR #563). `catch{}` was hiding DNS/network bugs in the telemetry pipeline; now writes a one-line diagnostic to stderr behind the env flag.

### Stale references and docs

- `docs/ARCHITECTURE.md` regenerated via `scripts/regen-arch-stats.sh`. Source: 43k LOC / 327 files; tests: 356 files / 4199 passing.
- Stale comments referencing the old `globalThis.__KJ_*` shape refreshed across `preflight-checks.js`, `iteration-loop.js`, `semantic-detector.js` to point at the typed `config.testHarness.*` getters (PR #563).

## [2.7.4] - 2026-04-24

### Changed (BREAKING contract, backward-compatible API)

- **Sonar is now intrinsic to Karajan for code tasks** (PR #468). Sonar runs unconditionally for every task classified as `sw`/`refactor`/`add-tests` and is skipped by policy for non-code tasks (`audit`/`doc`/`infra`/`analysis`/`no-code`). The `sonarqube.enabled` field in `kj.config.yml` is now **IGNORED** (with a deprecation warning emitted at run start). `--no-sonar` / `--sonar=false` CLI flags are also ignored with the same warning. Rationale: a code task without a quality gate, static analysis and issue enforcement is not a job Karajan can call complete — Sonar is part of the contract, like TDD. Solomon may still decide to skip a single iteration via runtime rule alerts (legitimate runtime override based on evidence); that path is unchanged. Users CANNOT pre-disable Sonar at config or flag level anymore. A new architectural invariant (`tests/architecture/sonar-intrinsic.test.js`) fails CI if anyone tries to reintroduce the toggle.

### Fixed

- **Preflight no longer falsely demands API keys Karajan doesn't use** (PR #466). Pre-v2.7.4, the preflight failed with "`ANTHROPIC_API_KEY not set`" / "`OPENAI_API_KEY not set`" — blocking every Claude Code MCP run where the parent uses OAuth (`apiKeySource: "none"`) — even though Karajan never calls provider APIs directly. Verified: zero SDK imports in `package.json`, zero `process.env.ANTHROPIC_API_KEY` reads in `src/agents/`. The check was pure dead weight from an earlier design. Now replaced with a **CLI availability** check (`cli:anthropic` → `checkBinary("claude")`, `cli:openai` → `codex`, etc.) that mirrors what Karajan actually does at runtime. The `token:gh` check stays — that one's legitimate (`git push` uses `GH_TOKEN`).
- **Orchestrator no longer crashes with `Cannot read properties of undefined (reading 'push')`** on the preflight-failure Solomon escalation path (PR #466). `addCheckpoint()` now defensively initialises `session.checkpoints = []` if missing; the init-error catch builds `tempSession` with `checkpoints: []` explicitly. Two-layer fix so the whole class of bug is gone, not just this one call site.

### Added

- **Architectural regression guards** (PR #466 + PR #468). Two new test files under `tests/architecture/` that fail CI on any future change that:
  - **`no-provider-apis.test.js`** — adds a provider SDK to `dependencies`/`devDependencies`, imports one from `src/`, reads a provider API key env var outside the preflight allowlist, or reintroduces a `token:<provider>` check (must be `cli:<provider>`, except the legitimate `token:gh`).
  - **`sonar-intrinsic.test.js`** — ANDs the preflight gate with `config.sonarqube?.enabled`, gates `runSonarStage` on the config instead of `resolved_policies.sonar`, makes `--no-sonar` mutate the config, or changes the policy so code task types don't require Sonar.

  Both files document the architectural rule and the "read-this-before-disabling" rationale in their JSDoc.

- **Self-explanatory "Not applicable" preflight messages** (PR #467). Check `applies(config)` can now return `{ applies: false, reason: "..." }` so users see *why* a check was skipped instead of a generic "Not applicable for current configuration". Wired into `createSonarPortCheck` and `createHuBoardPortCheck` for explicit skip reasons (external sonar, hu_board disabled).

- **`docs/TESTS.md`** (PR #467). New ~280-line test-suite guide: how to run / debug, directory map, ASCII pipeline-coverage diagram, per-directory explanation of what is tested and why, list of architectural invariants with "don't disable without a discussion" rationale, known coverage gaps, contribution checklist.

### Infrastructure

- Test harness gets a new `globalThis.__KJ_DISABLE_SONAR_STAGE` flag (default `true` under Vitest, set in `tests/setup.js`). Tests that legitimately exercise the sonar stage opt in per-describe or per-test. Same pattern as the existing `__KJ_DEFAULT_PREFLIGHT_EXTENDED`, `__KJ_DEFAULT_BRAIN_DECISOR`, `__KJ_DEFAULT_ADDYOSMANI_ENABLED`.
- Test count: 3 720 passing across 289 files. Lint clean on Node 18/20/22.

## [2.7.3] - 2026-04-23

### Added

- **`--task-file` / `taskFile` — read the task from a `.md` file** (PR #464). For anything beyond a one-liner, writing `kj run "very long multi-paragraph prompt..."` was painful. Every task-taking CLI command (`run`, `code`, `review`, `plan`, `discover`, `triage`, `researcher`, `architect`, `audit`) now accepts `--task-file <path>` and every matching MCP tool schema (`kj_run`, `kj_code`, `kj_review`, `kj_plan`, `kj_discover`, `kj_triage`, `kj_researcher`, `kj_architect`, `kj_audit`) accepts a `taskFile` argument. Precedence rule (same across CLI + MCP): positional `task` wins over `taskFile` when both are given, with a warning. Relative paths resolve against `projectDir` (or `cwd`). 256 KiB size cap. The positional `<task>` arg on every CLI command is now `[task]` (optional). New helper `src/utils/task-file.js` centralises parsing + precedence.

- **CLI `kj <cmd>` now writes `.kj/run.log` like MCP does** (PR #463). Previously only MCP handlers (`kj_run`, `kj_audit`, …) created the run log, so `kj-tail` was silent when Claude Code invoked `kj` via the Bash tool. New helper `src/utils/cli-run-log.js::withCliRunLog()` is wired into `run`, `audit`, `code`, `review`, `plan`, `discover`, `triage`, `researcher`, `architect`. Writes `[kj_<cmd>] started (cli)` / `finished — ok=<bool>` / `failed — <error>` markers plus per-event forwarding when the command has an EventEmitter (e.g. `kj run` mirrors every progress event into run.log alongside its existing activity-log path).

- **`kj-tail` v1.38.0 waits for the log to appear instead of exiting** (PR #464). Before: `kj-tail` hard-exited if `.kj/run.log` didn't exist yet, so users had to race the command and missed early lines. Now: prints a yellow notice listing which commands trigger the log, ensures `.kj/` exists, polls every 500 ms, and streams as soon as the log appears. Snapshot mode (`-s`) stays non-blocking. 4-hour safety cap avoids zombie panes.

### Fixed

- **Node 18 LTS users can now actually run `kj`** (PR #463). `package.json` had claimed `"engines": { "node": ">=18.0.0" }` for ages, but `src/checks/node.js` required Node 20 and failed at preflight with a misleading "needs structuredClone / findLast / AbortSignal.timeout / fetch" message. All four are Node 18 features. `MIN_NODE_MAJOR` lowered from 20 to 18. CI lint matrix gains `18.x` alongside `20.x` / `22.x` to catch any regression that would break Node 18 users. (Test matrix stays on 20+ because vitest 4 / rolldown — devDependencies only, never shipped to users — require `styleText` which is Node 20.12+.)

### Infrastructure

- Removed 8 stale merged local branches + 2 abandoned git worktrees under `.kj/worktrees/`.
- 22 new vitest cases across `tests/utils/task-file.test.js` and `tests/utils/cli-run-log.test.js`. Total suite: 3 702 tests across 287 files.

## [2.7.2] - 2026-04-23

### Added

- **Skills observability** (PR #461, follow-up to KJC-TSK-0327). Two improvements so the user can see which skills Karajan actually used per run:
  - `summary.md` gains a new **"Skills Used"** section listing the addyosmani/agent-skills action (`cloned` / `pulled` / `fresh` / `unavailable`) and the role/task-resolved slugs that were injected into role prompts, the OpenSkills actually installed this run, and OpenSkills recommended (would-have-used) when the CLI is missing. Section is elided when no skill activity happened. Data flows from `flow-runner.js` → `summary-writer.js` via a new `skills: { addyosmani, installed, recommended }` field on `SummaryInput`. Seven new vitest cases cover every combination + elision.
  - `kj-tail` **v1.37.0** gains a 🎯 filter for `[skills:*]` events — magenta for success (`ready` / `auto-install`), yellow for graceful-degradation paths (`unavailable` / `would have used`). Previously these lines fell through to the default styling without an icon, so skill decisions were hard to spot in the live tail.

## [2.7.1] - 2026-04-23

### Fixed

- **SEA binary release workflow has been broken since v2.4.1** (PR #459). Five releases (v2.4.1, v2.5.0, v2.6.0, v2.6.1, v2.7.0) shipped with empty GitHub Release assets because `scripts/build-sea.mjs` calls `await import("esbuild")` — an ESM dynamic import that resolves from local `node_modules`, not from globally-installed packages — while the workflow installed esbuild with `npm install -g`. Every tag push failed silently at "Build SEA binary" with `Cannot find package 'esbuild' imported from scripts/build-sea.mjs`. Fix: `esbuild` (`^0.28.0`) and `postject` (`^1.0.0-alpha.6`) are now declared as `devDependencies`; a single `npm ci` in the workflow pulls them into `node_modules` where the dynamic import can resolve them. Verified locally — `node scripts/build-sea.mjs` produces a working 119 MB `dist/kj` that reports `--version 2.7.1`. v2.7.1 is the first release since v2.4.0 to actually ship the `linux-x64` / `darwin-arm64` / `win-x64` binaries plus their SHA256 checksums.

## [2.7.0] - 2026-04-22

### Added

- **addyosmani/agent-skills as first-source process catalog** (KJC-TSK-0327, PR #456). Karajan now consults the [`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills) repository **before** OpenSkills when resolving which skills to inject into role prompts. The two providers cover orthogonal axes: addyosmani brings lifecycle/process workflows (TDD, code-review, security, performance, git-workflow, CI/CD, debugging, docs, spec-driven, planning...) mapped per Karajan role, while OpenSkills keeps providing stack-specific skills (astro, react, prisma, vitest-patterns...). On first use, the catalog is shallow-cloned into `~/.karajan/agent-skills/`; subsequent runs refresh via `git pull` after `skills.addyosmani.refreshDays` (default 7 days). When git is absent or the network is unreachable, the step degrades silently and the pipeline continues unblocked.
- **Role → addyosmani-slug mapping** — `src/skills/addyosmani-role-map.js` wires each Karajan role to its canonical workflows: `tester → test-driven-development + browser-testing-with-devtools`, `reviewer → code-review-and-quality + code-simplification`, `security → security-and-hardening`, `architect → spec-driven-development + api-and-interface-design + planning-and-task-breakdown`, `coder → incremental-implementation + source-driven-development + context-engineering + debugging-and-error-recovery`, and more. Task-text triggers add slugs on top (e.g. tasks mentioning "performance" or "Core Web Vitals" pull `performance-optimization`).
- **New config subtree** `skills.sources` (default `["addyosmani", "openskills", "local"]`) and `skills.addyosmani.{enabled,refreshDays,repoUrl}` validated by the Valibot schema.
- **New CLI subcommands**: `kj skills sync-addyosmani` forces a `git pull` of the catalog, `kj skills list-addyosmani` enumerates cached slugs with their descriptions.

### Infrastructure

- `tests/setup.js` defaults `__KJ_DEFAULT_ADDYOSMANI_ENABLED = false` under Vitest so orchestrator event-sequence tests don't spawn git probes. Tests that exercise the real catalog opt in per-case.
- 35 new test cases across `tests/skills/addyosmani-catalog.test.js` (25) and `tests/skills/addyosmani-role-map.test.js` (10) covering frontmatter parsing, clone/pull lifecycle, TTL, path-traversal guards and graceful degradation.

## [2.6.1] - 2026-04-20

### Fixed

- **hu-board: session.json without a matching auto-batch is no longer dropped** (KJC-BUG-0028). Previously `syncSessionFile` bailed with `if (!projectId) return;` when a session had no batch and no `project_id`, and it never called `upsertProject` even when `project_id` was present. Result: running `kj run "task"` without HU decomposition produced a session that was invisible on the board. Now `syncSessionFile` upserts the project row in that order: `auto-<sessionId>` → `data.project_id` → `default` (bucket `"Orphan sessions"`). Restores the two regressed tests in `packages/hu-board/tests/sync.test.js`.
- **hu-board: `fullScan` plans directory is now isolated for tests**. The scan of v2 plans previously hardcoded `~/.kj/plans/` via `homedir()`, so running the test suite flooded the output with entries from the developer's real machine. `KJ_PLANS_DIR` now overrides that path; the hu-board vitest config sets it to a non-existent placeholder so tests never read real plans.

### Infrastructure

- `packages/hu-board/vitest.config.js` sets `env.KJ_PLANS_DIR` for all test runs.

## [2.6.0] - 2026-04-19

### Added

- **Infrastructure Dependency Injection** (KJC-TSK-0316, PR #444) — `src/infrastructure/` introduces `FileSystemService`, `CommandRunner`, and an `Environment` bundle so tests can inject `MockFileSystem` / `MockCommandRunner` instead of spawning real subprocesses. `BaseAgent` now accepts an optional `Environment`; all 5 concrete agents (Claude, Codex, Gemini, Aider, OpenCode) route execution through the injected runner. Closes #364.
- **StageExecutor contract** (KJC-TSK-0315, PR #445) — `src/orchestrator/stages/stage-executor.js` defines the `StageExecutor` base class (`canRun` / `execute` / `onFailure`) + `StageRegistry` + `runStage()`. The orchestrator can iterate a stage registry instead of branching on `pipelineFlags` for every new feature. Closes #361.
- **Valibot config validation** (KJC-TSK-0318, PR #446) — `src/config/schema.js` validates merged YAML on load, catching `review_mode` typos, `max_iterations: 0`, non-integer iterations, invalid methodology, out-of-range `hu_board.port`, `budget.warn_threshold_pct` outside 0-100, and negative `max_budget_usd`. `KarajanConfig` @typedef exported via `v.InferOutput`. Builds on Jorge del Casar's closed PR #379 (co-authored). Closes #363, #367.
- **JSDoc typedef registry** (KJC-TSK-0317, PR #443) — central JSDoc typedefs for core entities (`KarajanConfig`, `Session`, `Stage`, `Agent`, `Hu`, `Policy`) under `src/types/`. Opt-in `tsc --noEmit` typecheck via `npm run typecheck` scoped to consumers using the new typedefs.
- **Budget comparison** (KJC-TSK-0274, PR #442) — session budget now shows "With KJ: $X / N tokens · Without KJ: ~$Y / ~M tokens (-Z%)" so you can see token savings from RTK + Brain compression at a glance.
- **Rich session journal** (PRs #439–#441) — `.reviews/<session>/decisions.md`, `iterations.md`, `summary.md`, `tree.txt` give an executive view of each run: stages table, budget breakdown, directory-grouped file status, per-iteration coder/reviewer/sonar/Solomon detail.

### Changed

- **`src/orchestrator.js` is now a 22-line barrel** (KJC-TSK-0315). The full 2 084-line monolith moved to `src/orchestrator/flow-runner.js`. Public API (`runFlow`, `resumeFlow`, `loadProductContext`, `shouldAutoContinueCheckpoint`, `parseCheckpointAnswer`) is re-exported so existing imports keep working.
- **HU Board auto-start gate simplified** (KJC-TSK-0273, PR #448) — `tryAutoStartBoard` now gates on `hu_board.auto_start` alone (no more double-gate on `enabled` + `auto_start`). Both call sites (init + post-planner auto-HU) share the new `renderBoardBanner()` helper and emit the same prominent cyan URL box. Skipped cleanly under `VITEST` / `NODE_ENV=test` to prevent detached server leaks.
- **Test audit + opt-in helper** (KJC-TSK-0307, PR #447) — 21 opt-in feature test files (brain, ci, sonar, hu-board, webperf) labelled `[opt-in: <feature>]`. New `tests/support/opt-in.js` helper + `KJ_SKIP_OPTIN_<FEATURE>=1` / `KJ_SKIP_ALL_OPTIN=1` escape hatches for fast feedback loops.

### Fixed

- **Falsy CLI overrides honored** (KJC-TSK-0318) — `--no-rebase` correctly sets `git.auto_rebase = false`, `--reviewer-retries 0` correctly sets `reviewer_options.retries = 0`, `--max-iterations 0` errors clearly instead of falling through to the default.

### Infrastructure

- Logo updated: README now uses the orbit logo shared with the landing page.
- Full suite: **3 638 tests / 283 files** (+48 new in this release).

## [2.5.0] - 2026-04-07

### Added

- **Mini Planning Game module** (KJC-PCS-0038) — independent planning system with two-phase workflow: plan first, then execute.
  - `kj plan "task"` — generates v2 plan with HUs (globally unique IDs, acceptance tests, task_type classification)
  - `kj plan list/show/validate/delete` — plan management
  - `kj plan ready <id>` — certify all HUs, mark plan as ready
  - `kj plan add-hu/remove-hu` — manual HU CRUD
  - `kj run --plan <id>` — executes plan's HUs via sub-pipeline with acceptance tests
  - Plan file updated in real-time as HUs execute (status: running → done/failed)
  - HU Board syncs from `~/.kj/plans/` — shows plans as projects with HU status
  - v2 schema with lazy v1→v2 migration, cycle detection in dependency graph

## [2.4.1] - 2026-04-07

### Fixed

- **Sonar quality gate runs for sw HUs** — acceptance_tests bypassed the entire standard pipeline including sonar. Now sonar runs between coder and acceptance_tests when `huPolicies.sonar === true`. If sonar fails, feedback goes to coder for next attempt.
- **HU Board shows rich data** — sync now extracts title, scope (certified.text), and acceptance_criteria from auto-generated HUs. Story detail modal shows "Scope" section with full text. Cards show real titles instead of "HU-01".
- **vitest updated** — 0 npm vulnerabilities (vite path traversal patched).

## [2.4.0] - 2026-04-07

### Added

- **Executable acceptance tests for HUs** — each HU now has `acceptance_tests`: an array of shell commands that Brain executes after each coder iteration. All pass → HU approved. Any fail → Brain reads the exact error output and sends a concrete diagnostic to the coder ("install @vitest/coverage-v8", not "Coverage: not measured"). No reviewer. No generic tester. Concrete pass/fail.

### Fixed

- **Security audit fixes** — command injection in `git add` (HIGH: `execSync` → `execFileSync`), allowlist bypass in `isCommandAllowed` (MEDIUM: `startsWith` → exact token match), credentials file permissions (MEDIUM: `0o644` → `0o600`), token masking in MCP responses (LOW).

### Changed

- Setup HU now explicitly includes coverage reporter installation in its scope and acceptance_tests.
- HU sub-pipeline: when `acceptance_tests` are defined, Brain runs a custom loop (coder → acceptance_tests → diagnose → retry) instead of the standard reviewer/tester pipeline.

## [2.3.2] - 2026-04-06

### Fixed

- **Per-HU policy application** — each HU's `task_type` now drives which pipeline stages run. `infra` HUs skip reviewer, sonar, TDD, and tester (only coder + impeccable). `sw` HUs get the full pipeline. Policies saved/restored per HU.
- **infra policy: reviewer disabled** — setup/scaffolding HUs don't need code review. They just need `npm install` + `npm test` to not crash.
- **Stack hint filtering** — when Node.js keywords are present (express, vite, vitest), Go keywords (gin, fiber) are removed. Prevents coder from creating a Go module in a Node.js project.
- **HU Board duplicate projects eliminated** — sessions never create projects. Only batches in `hu-stories/` are authoritative. Non-auto batches skipped if an auto- version already covers the session.

## [2.3.1] - 2026-04-06

### Fixed

- **"default" project removed from HU Board** — sessions without `project_id` now use `sessionId` and derive a readable name from `session.task` via `slugToTitle`. No more phantom "default" project with 0 stories.
- **Sync button (🔄) in HU Board header** — triggers `POST /api/sync` to re-scan disk for new batches without restarting the board. Shows ⏳ while scanning.

## [2.3.0] - 2026-04-06

### Fixed

- **Complete Brain audit — 21 v1 legacy violations fixed.** Exhaustive audit of all orchestrator stages found 21 places where Solomon was invoked directly (bypassing Brain), `session.task` leaked into per-HU context (causing reviewer to evaluate setup HUs against the full task spec), or feedback mutations skipped Brain's queue. All fixed:
  - `sonar-stage.js`: `brainCtx` parameter added, Solomon calls gated, sonar feedback pushed to Brain queue, `session.task` → task parameter
  - `coder-stage.js`: TDD handler Solomon gated, TDD failure pushed to Brain queue, user guidance pushed to queue
  - `reviewer-stage.js`: ALL reviewer rejections (including style-only) routed through Brain, `solomon:evaluate` → `brain:evaluate` when Brain active
  - `post-loop-stages.js`: security stage Solomon gated, security failure pushed to Brain queue
  - `solomon-escalation.js`: removed `|| session.task` fallback — `conflict.task` is now required
  - `orchestrator.js`: `brainCtx` threaded to `runQualityGateStages`, `runTddCheckStage`, `runSonarStage`, `runSecurityStage`; `runSingleIteration` uses `ctx.plannedTask || ctx.task` so per-HU reviewer evaluates the HU scope, not the full spec
- **HU Board `/api/sync` endpoint** — `POST /api/sync` triggers `fullScan()` to re-read all batch.json and session.json from disk. Frontend auto-syncs on page load and every 10s refresh. Fixes chokidar watcher not detecting new batches created after board start.
- **Model registry update** (Jorge del Casar #412) — Claude 4.6, GPT-5.4, Gemini 3.1, DeepSeek V4/R1, MiniMax M2.x. `registerModelAlias()` for CLI prefixes. Smart pricing fallback (exact → provider/model → prefix-strip).

## [2.2.1] - 2026-04-06

### Fixed

- **Setup HU no longer includes the full task description** — the HU-01 certified text was embedding the entire original prompt (2000+ chars), causing the coder to attempt implementing everything and the reviewer to reject because security middleware was "missing". Now the setup HU says explicitly: "DO NOT implement any business logic. This HU is ONLY project scaffolding."
- **Task HUs are truly minimal** — each HU references only the short project name (not the full prompt), includes "target <200 lines changed (like an atomic PR)", and directs the coder to not touch files outside the subtask's scope.
- **Legacy batch names in HU Board** — `sync.js` now derives project_name from "Part of: <originalTask>" embedded in story text for batches created before v2.2.0. Cryptic `s_2026-04-05T...` names become readable in the Board selector.
- **Extended stopwords** for project name derivation — added "this", "is", "it", "full", "full-stack", "stack", "based", etc. Fixes names like "Real-time Collaborative Task Board This Is".
- **Delete button moved to per-card** — 🗑️ appears top-right of each project card on hover (replaces less practical header button).

## [2.2.0] - 2026-04-06

### Added

- **HU Board UX overhaul** (KJC-PCS-0037):
  - **Human-readable `project_name`** — auto-generated HU batches derive a readable name from the task prompt (strips action verbs + stopwords, title-cases first 6 meaningful words). The Board selector now shows "Real-time Collaborative Task Board" instead of cryptic `auto-s_2026-04-05T...` IDs. `project_id` remains unique per run (includes timestamp) so repeated runs of the same prompt are distinguishable.
  - **DELETE endpoints + UI button** — `DELETE /api/projects/:id` (cascade: project + stories + sessions + removes `~/.karajan/hu-stories/<id>/` from disk), `DELETE /api/stories/:id`, `DELETE /api/sessions/:id`. Frontend shows a 🗑️ button next to the project selector when a specific project is chosen, with confirmation dialog.
  - **Port fallback** — when port 4000 is busy, `startBoard()` now tests availability via transient TCP bind and falls back to 4001, 4002... up to 4009. No more silent crashes on port collision.
  - **Auto-start on auto-HU** — when auto-generator produces a batch, the board starts automatically independent of `hu_board.auto_start`.
  - **Highlighted URL banner** — after auto-start, a cyan boxed banner with URL + project name is printed so users cannot miss it.

### Fixed

- `.kj/` worktrees excluded from vitest runs (stale worktree tests were polluting results).

## [2.1.1] - 2026-04-05

### Fixed

- **Auto-HU batch persistence path**: auto-generator wrote `batch.json` to `~/.karajan/hu/<sid>/` but the HU store reads from `~/.karajan/hu-stories/<sid>/`. Caused ENOENT crash when `runHuSubPipeline` tried to load the auto-generated batch. Fixed by using the correct `hu-stories/` directory.

## [2.1.0] - 2026-04-05

### Added

- **Auto-HU Decomposition** (KJC-PCS-0035): when a task is complex and triage recommends decomposition, Karajan now automatically generates a certified HU batch and runs each HU as an independent sub-pipeline with its own atomic git branch/PR. No more 50-file blob tasks.
  - **HU auto-generator** (`src/hu/auto-generator.js`): converts triage subtasks into an HU batch with automatic setup HU when the project is new or has stack hints. Classifies each HU into a `task_type` (infra/sw/add-tests/doc/refactor/nocode) so downstream policy gates apply correctly per HU.
  - **Wiring**: after triage + researcher + architect + planner, if triage recommended decomposition and no manual `--hu-file` was passed, the batch is persisted to `.karajan/hu/auto-<sid>/batch.json` and injected as `stageResults.huReviewer`. The existing `needsSubPipeline` / `runHuSubPipeline` infrastructure picks it up.
  - **Per-HU max_iterations**: each HU gets a focused iteration budget (default 3, configurable via `config.hu_max_iterations`) and a fresh Brain state (feedback queue, verification tracker, extension count reset to 0) so issues from one HU never bleed into the next.
  - **Per-HU git automation** (`src/git/hu-automation.js`): each HU gets its own branch (`feat/HU-<id>-<slug>`) chained from its parent HU's branch (or `base_branch` for root HUs). On approval: commits atomically with `feat(HU-<id>): <title>`, optionally pushes and opens a PR (gated by existing `git.auto_commit`/`auto_push`/`auto_pr` flags).

### Fixed

- `emitAgentOutput` helper unified across all stages (coder, reviewer, refactorer, architect, planner, researcher, triage).

## [2.0.2] - 2026-04-05

### Added

- **Brain compression + feedback queue across all stages** (not just reviewer). Researcher, architect, planner outputs are compressed; tester and security failures enter the typed feedback queue with enrichment for the next coder iteration.
- **Brain owns max_iterations decision.** Brain inspects its feedback queue state at max_iterations: security entries → pause for human, correctness/tests → extend iterations, empty queue → finalize, style-only → consult Solomon as advisor. Solomon is never invoked directly from max_iterations anymore.
- **Agent action lines in quiet mode.** `kj run` now interprets Claude's stream-json tool_use blocks into concise action lines (`Read packages/server/index.js`, `Bash $ npm install express`, etc.), so users can see what the coder is doing without enabling verbose mode.
- **Heartbeat visible in quiet mode.** `agent:heartbeat` events (every 30s) are no longer suppressed, so `kj run` shows a status line (`⏳ claude working — 45s elapsed`) instead of looking hung during long agent calls.
- **ASCII banner printed on `kj run`** regardless of TTY detection (was silently skipped in many environments).

### Fixed

- **`kj run` no longer looks hung.** Combined with heartbeat + action lines, long-running agents show clear progress.

### Changed

- **`solomon:alert` event renamed to `brain:rules-alert`** (display: "⚠️ Rules alert" instead of "⚖️ Solomon alert"). The rules engine emits telemetry; it is not an invocation of Solomon.
- All stage `onOutput` handlers now go through the unified `emitAgentOutput` helper, routing `kind=tool` to `agent:action` (visible in quiet mode) and everything else to `agent:output` (verbose only).

## [2.0.1] - 2026-04-05

### Fixed

- **Brain actually wired to pipeline**. v2.0.0 shipped Brain modules but nothing imported them — the pipeline still ran v1 Solomon-as-boss logic. This release wires Brain into the actual execution path.
  - `brainCtx` created at session init, threaded through coder and reviewer stages
  - Coder stage uses enriched feedback prompts from Brain's typed queue
  - Coder stage calls `verifyCoderRan` after each run; stalls after N consecutive 0-change iterations
  - Reviewer stage: on correctness/tests/security rejections, Brain bypasses Solomon and pushes issues to feedback queue (Solomon only consulted on style-only dilemmas)
- **Brain owns human escalation** — `solomon-rules` no longer prompts user directly. When Brain is enabled, rule alerts route through Brain → Solomon AI judge → human (only if neither resolves).
- **Brain actively consults Solomon** on critical dilemmas (stale iterations, new deps) and applies Solomon's decision (approve/continue/pause).
- **Stale detection data** — reviewer checkpoints now record a feedback signature, coder checkpoints record `filesChanged`. Previously both were empty/zero, making solomon-rules falsely detect "stale" after 3 iterations with different bugs.
- **HU Board auto-start crash on nvm/macOS** (reported by Jorge del Casar). `spawn("node", ...)` failed with ENOENT because detached subprocess didn't inherit node's PATH. Fixed by using `process.execPath`. Added error handler to prevent unhandled `error` event from crashing parent process.

### Changed

- **Brain enabled by default** (`brain.enabled: true`). v2 is Brain architecture; users who explicitly don't want Brain can set `brain.enabled: false`, but the canonical v2 experience is Brain-on.

## [2.0.0] - 2026-04-04

Major release. See [MIGRATION-v2.md](./MIGRATION-v2.md) for upgrade guide.

### Breaking Changes

- **Proxy subsystem removed** — the HTTP proxy did not work with SSE streaming (Claude) or WebSockets (Codex). Use RTK (auto-detected) for token savings. Removed: `src/proxy/`, `config.proxy.*` keys, `--proxy` / `--no-proxy` / `--proxy-port` flags, `enableProxy` MCP arg.
- **`becaria` → `ci` rename** — the CI/CD integration renamed from "BecarIA" to "ci" (BecarIA is a Planning Game developer ID, not a Karajan concept). Breaking: `config.becaria` → `config.ci`, `--enable-becaria` → `--enable-ci`, `session.becaria_pr_number` → `session.ci_pr_number`, default events `becaria-review`/`becaria-comment` → `kj-review`/`kj-comment`, GitHub secrets `BECARIA_APP_ID`/`BECARIA_APP_PRIVATE_KEY` → `KJ_CI_APP_ID`/`KJ_CI_PRIVATE_KEY`, workflow `becaria-gateway.yml` → `kj-ci-gateway.yml`.
- **Tester and Security are blocking gates** — previously advisory (auto-continued if reviewer approved). Now their failures send feedback back to coder for fixing, like reviewer rejections.
- **Solomon no longer overrides security issues** — deterministic guard: when reviewer reports security-category issues, they always go back to coder. Solomon is bypassed for security.
- **Scope guard `max_files_per_iteration` removed** — the 10-file limit was wrong for greenfield projects. Coder prompt now enforces atomic commits instead.
- **Dead config keys removed** — `retry.*`, multiple dead `proxy.*` sub-keys eliminated from DEFAULTS.

### Added — Karajan Brain Architecture (Epic KJC-PCS-0034)

New AI-powered orchestration layer (opt-in via `brain.enabled: true`). Separates concerns between Karajan Brain (CEO/orchestrator) and Solomon (advisor/judge).

- **Karajan Brain Role** (`src/roles/karajan-brain-role.js`) — central orchestrator that decides routing, enriches prompts, suggests direct actions
- **Brain Skills** (`templates/roles/karajan-brain.md`) — 7 skills: route-decision, prompt-enrichment, output-verification, direct-action, rtk-compression, stack-detection, dependency-management
- **Solomon refined as AI Judge** — consulted only on genuine dilemmas (security-vs-deadline, conflicting gates, stalled loops, risk evaluation)
- **Structured feedback queue** (`src/orchestrator/feedback-queue.js`) — typed message queue replaces flat `last_reviewer_feedback` string
- **Feedback enrichment** (`src/orchestrator/feedback-enrichment.js`) — transforms vague feedback into actionable file paths + numbered action plans
- **Verification gate** (`src/orchestrator/verification-gate.js`) — detects 0-change coder iterations, tracks stuck loops
- **Direct actions** (`src/orchestrator/direct-actions.js`) — allow-listed commands (npm install, create_file, update_gitignore, git_add) with path traversal guards
- **Role output compressor** (`src/orchestrator/role-output-compressor.js`) — per-role strategies for 40-70% token savings between roles
- **Brain coordinator** (`src/orchestrator/brain-coordinator.js`) — ties all modules together

### Added — Reliability Improvements

- **Smart init** — `kj run` auto-detects installed AI CLIs and assigns them to roles by capability (claude=5, codex=4, gemini=3). Diversifies reviewer from coder, Solomon from Brain.
- **Auto-init** — creates git repo, `.gitignore`, `.karajan/` scaffolding automatically when missing
- **Stack-aware .gitignore** — after planner detects language, adds stack-specific entries (node_modules/, __pycache__/, target/, etc.)
- **Diff scoping to projectDir** — prevents reviewer from seeing unrelated branch changes when running from a subdirectory
- **Session journal** — persists pipeline state to `.reviews/session_*/` with stage outputs, iterations log, decisions, tree, summary
- **Chrome DevTools MCP auto-detection** from `~/.claude.json`
- **AgentRole base class** — eliminates boilerplate across 13 LLM-backed roles

### Removed

- Proxy subsystem (see Breaking Changes)
- 15 dead exports across src/
- 9 deterministic compressor files (consolidated into 2 registries)

### Fixed

- Tester now executes real test commands with coverage (vitest/jest/pytest/etc.) instead of LLM-guessing
- RTK display explains 0% savings (previously looked broken)
- Logger uses local time instead of UTC
- Scope guard respects projectDir (files inside projectDir always in scope)
- `categorizeIssues` precision: "auth route test" no longer classified as security

### Internal

- AgentRole base class extracts common LLM-role boilerplate (~1200 LOC reduction)
- Orchestrator extracted into config-init, becaria-integration, flow-control modules
- Deterministic compressors consolidated (11 files → 4)
- Session journal integrated into pipeline

## [1.58.2] - 2026-04-01

### Fixed
- **Test fix**: buildAskQuestion test updated for capabilities detection (#316)
- **Branch protection**: enforce PRs for all pushes to main (including admins)

## [1.58.1] - 2026-04-01

### Added
- **CLI welcome screen**: running `kj` with no arguments shows a branded welcome with version, configured agents, and quick start commands. Uses Commander's `program.action()` so `kj --help` still works normally (#312, by @reiaguilera)

## [1.58.0] - 2026-04-01

### Added
- **Domain Knowledge System**: new `domain-curator` role discovers, proposes and synthesizes business-domain knowledge from `~/.karajan/domains/` (user/company bank) and `.karajan/domains/` (project overrides). Domain context is injected into all downstream roles (Researcher, Architect, Planner, Coder, Reviewer, HU-Reviewer) as a `## Domain Context` section (#315)
- **Domain Loader**: parses `DOMAIN.md` files with YAML frontmatter (name, description, tags, version, author, visibility) and markdown sections (Core Concepts, Terminology, Business Rules, Common Edge Cases). Cascading resolution: project-local overrides user-global by directory name
- **Domain Registry**: local JSON index at `~/.karajan/domain-registry.json` with search by tags, name and description. Interface prepared for future remote registries
- **Domain Synthesizer**: filters relevant domain sections by keyword overlap with task + hints, compacts output to token budget (default 4000 tokens)
- **Enhanced askQuestion**: detects host MCP capabilities (`server.getClientCapabilities()?.elicitation`) and adapts behavior — `askQuestion.interactive` boolean, structured question types (multi-select, select, confirm, text), free-text response parser, default policies per stage
- **Triage domainHints**: triage now detects business-domain keywords and outputs `domainHints[]` for the Domain Curator to search domains
- **Skill-loader type discrimination**: `SKILL.md` files with `type: domain` frontmatter are loaded by the Domain Curator (injected globally) while `type: technical` (default) skills remain coder-only
- **Pipeline**: 15 → 16 roles. Domain Curator slots after triage + skill auto-install and before researcher/architect/planner
- 102 new tests across 8 test files

## [1.57.2] - 2026-04-01

### Added
- **`kj init` gitignore entries**: auto-appends `.kj/`, `.agent/`, `.scannerwork/` to project `.gitignore` if missing (#310)

### Fixed
- **Model/provider resolution**: when model is `gemini/pro`, infer provider=gemini and strip prefix. Drop incompatible explicit models (#305)
- **SonarQube auto-start**: wait up to 60s after `docker compose up` instead of checking once immediately. Fixes false "auto-start failed" on cold boot (#306)
- **Subprocess stdin hangs**: all subprocesses now run with `stdin: "ignore"`. Prevents indefinite hangs when sonar, agents, or npm prompt for input (#307)
- **CI**: removed deprecated macOS Intel runner (macos-13) from release workflow (#304)
- **.gitignore**: added `.claude/`, `.scannerwork/`, `.agent/`, `dist/`, `.kj/` (#308, #310)

## [1.57.1] - 2026-03-31

### Added
- **SEA binary build**: standalone binary via `node scripts/build-sea.mjs`. No Node.js required to run
- **Release workflow**: GitHub Actions builds binaries for linux-x64, darwin-arm64, darwin-x64, win-x64 with SHA256 checksums on every tag

### Fixed
- **YAML duplicate keys**: config loader now tolerates duplicated keys in user config files (#300)

## [1.57.0] - 2026-03-31

### Added
- **Telemetry (opt-out)**: anonymous usage statistics (version, OS, command, pipeline duration, success rate). No code or personal data. Opt out with `telemetry: false` in config (#295)
- **MCP graceful restart**: after `npm update`, the MCP server writes a restart marker file and exits with a 2-second grace period. The new instance detects the marker and logs reconnection context (#294)
- 25 new tests (telemetry, MCP reconnect, resume config snapshot)

### Fixed
- **Resume respects session flags**: `kj_resume` now uses the session's saved config snapshot instead of loading a fresh config. Flags like `--no-sonar` from the original run are preserved (#297)
- **Circular ESM imports (TDZ)**: extracted shared helpers from server-handlers.js into separate modules, breaking the circular dependency chain that caused 30 test failures (#296)

## [1.56.0] - 2026-03-31

### Added
- **`kj status` dashboard**: terminal view showing HU states (pending/coding/reviewing/done/failed), current stage, timing, and progress. MCP returns structured JSON (#292)
- **`kj init` auto-detect stack**: scans package.json/go.mod/Cargo.toml/etc., detects frameworks (React, Express, Astro, Go, Rust...), auto-enables impeccable for frontend, suggests skills (#290)
- **HU Board authentication**: optional Bearer token auth via `HU_BOARD_TOKEN` env var. API endpoints protected, static assets public. Backward compatible (#291)
- 39 new tests

## [1.55.0] - 2026-03-31

### Added
- **`kj undo`**: revert last pipeline run with `kj undo` (soft reset) or `kj undo --hard`. 24th MCP tool (#288)
- **Documentation links in errors**: all error messages include a "See:" link to the relevant doc page (#287)

### Fixed
- **0 test failures**: fixed 2 pre-existing stale assertions in pg-decomposition and checkpoint-ui tests (#286)

## [1.54.0] - 2026-03-31

### Added
- **`--design` flag**: activates impeccable role in refactoring mode. Coder applies design changes (hierarchy, spacing, responsive, a11y, animations, theming) instead of just auditing. New `impeccable-design.md` template. Works from CLI and MCP (#284)
- 11 new tests

## [1.53.1] - 2026-03-31

### Changed
- **MCP response compressor**: all tool responses are now compressed before sending to host AI. Strips verbose fields from lists, truncates arrays (20 items), commits (last 5), findings (first 10). Compact JSON without indentation. Vital fields preserved (#281)

## [1.53.0] - 2026-03-31

### Added
- **Plan → Run connection**: `kj_plan` now runs researcher + architect before planner and persists the result. `kj_run --plan <planId>` loads the persisted plan context and skips pre-loop stages. Plans stored in `~/.kj/plans/` (#279)
- Plan store: savePlan, loadPlan, listPlans, getLatestPlan
- CLI: `kj run --plan <planId>`
- 10 new tests

## [1.52.0] - 2026-03-31

### Added
- **No-code pipeline mode**: triage detects non-coding tasks (data analysis, SQL queries, CSV transforms, reports) and disables TDD + SonarQube automatically. Coder generates output, reviewer validates logic (#277)
- **3 no-code skills**: `kj-sql-analysis` (query generation + injection checks), `kj-csv-transform` (delimiter detection, encoding, validation), `kj-data-report` (structured reports with methodology) (#276)
- Skill detector patterns for SQL, CSV, and report tasks
- 26 new tests

## [1.51.0] - 2026-03-30

### Added
- **RTK real integration** (epic KJC-PCS-0028): auto-install during kj init, enforce RTK wrapping in all internal Bash commands (git, diff, ls), measure and report token savings per session (#270, #271, #272)
- **RTK savings in reports**: session end shows estimated tokens saved, compression ratio, command count. `kj report --trace` includes RTK stats

### Fixed
- **Audit/analysis tasks skip coder**: `kj run "audit security..."` now routes to security+audit roles without running coder/reviewer. Intent guard detects audit keywords in EN/ES (#269)

### Changed
- `kj doctor` shows RTK as MISS with install instructions when not found

## [1.50.1] - 2026-03-30

### Fixed
- **Pipeline messages respect configured language**: new message catalog (`src/utils/messages.js`) with EN/ES translations for triage, Solomon, checkpoints, preflight. All user-facing messages use `msg(key, lang)` instead of hardcoded English (#267)
- **Checkpoint UI restructured**: numbered options (1/2/3) instead of ambiguous answer field + Accept/Decline buttons. Each option explains what it does. Backward compatible with "yes"/"sí"/"no" (#266)
- 34 new tests

## [1.50.0] - 2026-03-30

### Added
- **71 unit tests** for server-handlers, pre-loop-stages, and iteration-stages. The 3 most critical modules now have dedicated test coverage (#260)

### Changed
- **Split 3 god-modules** into 12 focused sub-modules: server-handlers → 4 handler files, pre-loop-stages → 5 stage files, iteration-stages → 3 stage files. Original files become thin re-exporters. Zero API changes (#261)

## [1.49.0] - 2026-03-30

### Changed
- **Async I/O**: all sync file operations in basal-cost.js and store.js replaced with async equivalents. Prevents event loop blocking during long pipelines (#256)
- **Centralized SonarQube config**: new `sonar/config-resolver.js` replaces duplicated host/token/credentials resolution in scanner, preflight, and API modules. 14 new tests (#257)
- **Documented 61 empty catch blocks**: every silent catch now has an inline comment explaining intent. Zero logic changes, 39 files touched (#258)

## [1.48.0] - 2026-03-30

### Added
- **PG card lifecycle tracking** (epic KJC-PCS-0026): kj_run auto-marks PG cards In Progress at start, accumulates commits during pipeline, marks To Validate on approval with all commits and PR info. Best-effort, never blocks pipeline. 13 new tests (#254)
- **HU Board real-time status sync**: HU status transitions at each stage (coding → reviewing → done/failed), batch saved after each change for chokidar sync, hu:status-change events with timestamps. 9 new tests (#253)
- 2388 tests across 186 files

## [1.47.0] - 2026-03-30

### Added
- **HU Story Splitting**: linguistic indicator detection (6 categories: conjunctions, wildcard verbs, sequence, scope expansion, optionality, exceptions), heuristic-based sub-HU generation with FDE confirmation, 4-criteria validation (independently valuable, deployable alone, completable in 3 days, vertical). Horizontal splits rejected. Splitting metadata stored for traceability (#249, #250, #251)
- 64 new tests (2366 total across 184 files)

### Fixed
- **kj_audit MCP returns compact summary**: full audit details stay in session log, MCP response is compact JSON with health score, top 5 recommendations, and basal cost summary. Prevents host AI from receiving oversized payloads

## [1.46.0] - 2026-03-30

### Added
- **Parallel HU execution**: independent HUs run concurrently using git worktrees. `findParallelGroups` detects parallel batches, each HU gets its own worktree, results merge back sequentially. Failed HUs block dependents but not siblings. 13 new tests (#247)
- **SEA binary build**: `scripts/build-sea.mjs` bundles via esbuild and generates standalone binaries via Node 22 SEA. `.github/workflows/release-binaries.yml` produces kj-linux-x64, kj-macos-arm64, kj-win-x64.exe on every tag push (#246)
- **Python wrapper**: `wrappers/python/` with pip-installable package. `pip install .` provides `kj` command that delegates to npm global or npx (#245)
- **Docker image**: `Dockerfile` (Alpine + Node 20), `docker-compose.yml`, `docs/DOCKER.md` bilingual (#237)
- **Shell installer**: `scripts/install-kj.sh` for `curl | sh` installation with OS/arch detection (#238)
- 2318 tests across 182 files

## [1.45.0] - 2026-03-30

### Added
- **WebPerf Quality Gate** (epic KJC-PCS-0015): Core Web Vitals as pipeline quality gate
- **Chrome DevTools MCP detection**: auto-installs WebPerf Snippets skills (Joan Leon) when DevTools MCP configured (#242)
- **CWV evaluation**: LCP/CLS/INP measured against Google thresholds (good/needs-improvement/poor). Configurable via `webperf.thresholds` in kj.config.yml (#243)
- 30 new tests (2305 total across 181 files)

## [1.44.0] - 2026-03-30

### Added
- **i18n**: `kj init` detects OS locale and asks for pipeline language + HU language. Agents respond in the configured language. Supports English and Spanish, extensible. 18 new tests (#240)

## [1.43.0] - 2026-03-29

### Added
- **Docker image**: Alpine + Node 20, `docker run karajan-code kj --version`. Includes docker-compose.yml and bilingual docs/DOCKER.md (#237)
- **Shell installer**: `curl https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-kj.sh | sh` detects OS/arch, installs Node.js if needed, installs karajan-code, runs kj init (#238)

## [1.42.0] - 2026-03-29

### Added
- **Lean audit: basal cost** (epic KJC-PCS-0023): `kj audit` now measures dead code, unused dependencies, complexity growth between audits. Saves snapshots for trend tracking. Uses `git ls-files` for fast file enumeration (#235)
- **Lazy HU planning**: subsequent HUs are refined with context from completed ones instead of all planned upfront. First HU fully planned, rest get `needsRefinement: true` and are refined lazily (#234)
- 17 new tests (2257 total across 178 files)

## [1.41.0] - 2026-03-29

### Added
- **OpenSkills integration** (epic KJC-PCS-0024): Karajan auto-detects domain skills needed for each task
- **`kj_skills` MCP tool** (23rd): install, remove, list, read OpenSkills from marketplace or GitHub (#230)
- **Skill injection in prompts**: coder, reviewer, architect prompts now include domain-specific knowledge from installed skills (#231)
- **Triage auto-install**: detects frameworks (Astro, React, Vue, Express, etc.) and language markers, installs matching skills automatically, cleans up after pipeline (#232)
- 57 new tests (2240 total across 176 files)

## [1.40.0] - 2026-03-29

### Added
- **Pipeline sovereignty guard**: MCP handler validates kj_run params, strips host AI overrides (enableHuReviewer, enableTriage), clamps maxIterations [1,10], blocks duplicate sessions. 18 new tests (#227)
- **`kj_suggest` MCP tool** (22nd): host AI proposes observations to Solomon without override power. Solomon reads suggestions in next evaluation. 8 new tests (#228)
- **E2E install tests**: Docker smoke tests (14 checks) + GitHub Actions matrix (ubuntu, macOS, Windows). `kj init` disables sonar gracefully when Docker unavailable (#221, #222, #223, #226)
- **CLI update notification**: non-blocking npm version check at startup, cached 24h (#218)

## [1.39.0] - 2026-03-29

### Added
- **CLI update notification**: non-blocking check at startup, cached 24h. Shows available update with install command. 8 new tests (2157 total across 171 files)

## [1.38.2] - 2026-03-28

### Fixed
- **Reviewer sees new files**: `git add -A` before generating reviewer diff, so coder-created files are visible. Fixes scaffold tasks looping forever (#214)
- **Secrets always block**: all 15 credential patterns now critical severity. Hardcoded keys block the pipeline. Added: OpenAI, Anthropic, Stripe, Google, Firebase, Slack, JWT, database URLs (#213)
- **Coder .env mandate**: coder template explicitly requires `.env` + `process.env` for all keys, `.env.example` creation, `.gitignore` check

## [1.38.1] - 2026-03-28

### Added
- **`kj_hu` MCP tool** (21st tool): create, update, list, get HUs manually in the board. Auto-creates project from directory name + git remote (#208)
- **Multi-language TDD**: detects test frameworks for 12 languages (Java/JUnit, Python/pytest, Go, Rust/cargo, C#/.NET, Ruby/RSpec, PHP/PHPUnit, Swift/XCTest, Dart). TDD enforcement works for all languages, not just JS (#207)
- **MCP sovereignty**: tool descriptions explicitly instruct host AIs to pass tasks as-is without grouping, reordering, or overriding pipeline decisions (#210)
- 35 new tests (2142 total across 170 files)

### Fixed
- **Solomon messages**: escalation messages are now human-readable structured text instead of raw JSON. Shows reviewer feedback, Solomon decision, and clear options (#209)
- **Sonar token**: actionable error with 3 fix options when token is missing, instead of silently disabling sonar (#211)

## [1.38.0] - 2026-03-26

### Added
- **Integrated HU Manager** (epic KJC-PCS-0021): the HU system is now the nervous system for complex tasks
- **Triage auto-activates hu-reviewer**: medium/complex tasks get automatic story decomposition without manual flags (#197)
- **AI-driven task decomposition**: complex tasks decompose into 2-5 formal HUs with structured descriptions, acceptance criteria, and dependency graphs (#199)
- **Sub-pipeline per HU**: each certified HU runs as its own sub-pipeline (coder, sonar, reviewer) with per-HU state tracking (pending, coding, reviewing, done, failed, blocked). Failed HUs block dependents via transitive dependency resolution (#201)
- **PG adapter feeds hu-reviewer**: Planning Game card data (descriptionStructured, acceptanceCriteria) automatically converted to HU format when pgTaskId is set (#200)
- **History records for all pipeline runs**: every pipeline run (simple or complex) creates a lightweight HU record visible in the HU Board (#198)
- **"Why vanilla JavaScript?" essay**: personal perspective on the JS vs TS choice (docs/why-vanilla-js.md)
- 49 new tests (2093 total across 166 files)

## [1.37.0] - 2026-03-25

### Added
- **Injection guard**: prompt injection scanner for AI-reviewed diffs and PRs. Scans diffs before passing them to AI reviewers, detecting directive overrides ("ignore previous instructions"), invisible Unicode characters (zero-width spaces, bidi overrides), and oversized comment block payloads. Integrated in pipeline (blocks review) and as GitHub Action on every PR
- **Community templates**: CODE_OF_CONDUCT.md, CONTRIBUTING.md, issue/PR templates (bilingual EN/ES)
- **Executor info in pipeline output**: all stage events show provider name and execution type (AI/skill/local)
- **Windows compatibility**: `where` instead of `which`, AppData search dirs, .cmd/.exe/.bat extensions, SIGTERM on Windows, Windows install commands
- 33 new injection guard tests (2044 total across 161 files)

### Fixed
- CI test failures (missing mocks after vi.resetAllMocks)
- Branch protection enabled on main (PR required)
- Auto-delete merged branches enabled

### Security
- SECURITY.md made bilingual (EN + ES)

## [1.36.1] - 2026-03-25

### Added
- **kj-tail as installable CLI command**: `kj-tail` with `--help`, filtering (`-v`, `-t`, `-s`, `-n`), and snapshot mode
- **Three ways to use Karajan** documented: CLI, MCP, kj-tail with full pipeline example
- **Executor info**: provider and execution type (AI/skill/local) in all pipeline stage events

### Fixed
- Propagate Solomon error details to escalation and activity log

## [1.36.0] - 2026-03-25

### Added
- **Budget tracking from real agent usage**: Claude agent extracts `tokens_in`, `tokens_out`, `cost_usd` and `model` from CLI JSON output. Codex agent parses `tokens used` from stdout. Budget display now shows real costs instead of "N/A"
- **Token estimation fallback**: when agents don't report usage, budget tracker estimates tokens from output text length (~4 chars/token). Marked as `estimated: true` in budget entries
- **Solomon error propagation**: Solomon failure details now logged to activity log, shown in event messages, saved in session checkpoints, and passed as escalation reason (previously showed "UNKNOWN")

### Fixed
- **Model-not-supported resilience**: all agents (Claude, Codex, Gemini, Aider, OpenCode) detect "model not supported" errors and automatically retry without the custom model flag, falling back to the agent's default model. Prevents pipeline failures when smart model selection picks a model unavailable for the user's account tier
- **Solomon context for first rejections**: Solomon now receives `isFirstRejection`, `isRepeat`, `issueCategories` and `blockingIssues` in its prompt, enabling correct `approve_with_conditions` decisions on first reviewer rejections instead of unnecessary human escalation

## [1.35.0] - 2026-03-24

### Added
- **Mandatory bootstrap gate**: new `.kj-ready.json` checkpoint per project that validates ALL environment prerequisites before any KJ tool executes. Checks: git repo, git remote origin, KJ config, core binaries (node/npm/git), coder agent CLI, SonarQube (when enabled). Results cached for 24 hours. If any check fails, KJ stops with a clear error message and actionable fix instructions — no silent fallbacks or graceful degradation
- **Bootstrap gate on 12 MCP handlers**: `kj_run`, `kj_code`, `kj_review`, `kj_plan`, `kj_discover`, `kj_triage`, `kj_researcher`, `kj_architect`, `kj_audit`, `kj_resume`, `kj_scan` all validate environment before execution
- **Secure SonarQube credentials file**: `~/.karajan/sonar-credentials.json` for admin credentials. Format: `{"user": "admin", "password": "your-password"}`
- **`bootstrap_error` classification**: bootstrap failures classified as non-recoverable — auto-resume will not retry
- 19 new bootstrap tests + 1 error classification test (1966 total)

### Fixed
- **Hard-fail preflight checks**: SonarQube preflight checks during pipeline execution now BLOCK the pipeline (`ok: false` + `errors[]`) instead of silently auto-disabling SonarQube via `configOverrides.sonarDisabled`. Security agent checks remain graceful (warning only)

### Security
- **Removed default admin/admin SonarQube credentials**: the hardcoded `"admin"` password fallback in `resolveSonarToken()` and `checkSonarAuth()` has been removed. Credential resolution chain is now: (1) `KJ_SONAR_TOKEN` / `SONAR_TOKEN` env var, (2) `sonarqube.token` in `kj.config.yml`, (3) admin credentials from env vars / config / `~/.karajan/sonar-credentials.json`. Hard fail with actionable message if nothing configured
- **`admin_user` default changed from `"admin"` to `null`** in config defaults — explicit configuration required

### Changed
- `src/orchestrator/preflight-checks.js`: result now includes `errors: []` field alongside existing `warnings: []`
- `src/orchestrator.js`: consumes `preflightResult.ok === false` and throws Error with fix instructions
- `.gitignore`: added `.kj-ready.json`

## [1.34.4] - 2026-03-23

### Fixed
- **OS-aware install commands**: macOS uses `brew install`, Linux uses `curl`/`apt`/`pipx` for agent CLI installation suggestions in `kj doctor` and error messages

## [1.34.3] - 2026-03-22

### Changed
- **Cognitive complexity refactoring**: reduced cognitive complexity across 6 core files

## [1.34.2] - 2026-03-22

### Fixed
- **Zero skipped tests**: eliminated all skipped tests + added 44 board backend tests

## [1.20.0] - 2026-03-14

### Added
- **Standalone CLI commands**: `kj discover`, `kj triage`, `kj researcher`, `kj architect` — clean subcommands for running pre-loop roles independently, instead of requiring `kj run --enable-*` flags
- Each command supports role-specific flags: `--mode` for discover, `--context` for architect, `--json` for structured output

## [1.19.0] - 2026-03-14

### Added
- **OpenCode agent**: 5th built-in AI agent — open-source CLI with multi-provider support. Contributed by [@aitorGeniova](https://github.com/aitorGeniova) (#75)

## [1.18.0] - 2026-03-14

### Added
- **Output guard**: scans git diffs for destructive operations (rm -rf, DROP TABLE, git push --force), exposed credentials (AWS keys, private keys, tokens), and protected file modifications. Blocks pipeline on critical violations.
- **Perf guard**: scans frontend file diffs for performance anti-patterns (images without dimensions/lazy, render-blocking scripts, missing font-display, document.write, heavy deps). Advisory by default, configurable to block.
- **Intent classifier**: keyword-based deterministic pre-triage classification. Classifies obvious task types (doc, add-tests, refactor, infra, trivial-fix) without LLM call when enabled.
- **Guards config schema**: `guards.output`, `guards.perf`, `guards.intent` in kj.config.yml with custom patterns, protected files, and confidence thresholds
- **Pipeline guard integration**: guards run between coder+refactorer and quality gates; intent classifier runs before discover/triage in pre-loop

## [1.17.0] - 2026-03-14

### Added
- **ArchitectRole**: new pre-construction design role that defines solution architecture (layers, patterns, data model, API contracts, tradeoffs) between researcher and planner stages
- **Interactive architecture pause**: when architect detects ambiguity (`verdict: "needs_clarification"`), pipeline pauses to ask targeted questions via `askQuestion`
- **Auto ADR generation**: architectural decisions from tradeoffs are automatically persisted as Architecture Decision Records in Planning Game when a card is linked
- **Triage → architect activation**: triage automatically activates architect based on task complexity, scope (new modules, data model changes), and design ambiguity
- **Planner architectContext**: planner receives and uses architectural decisions to generate implementation steps aligned with the designed architecture
- **`--enable-architect` CLI flag** and `enableArchitect`/`architectModel` MCP parameters for explicit control
- **`templates/roles/architect.md`**: LLM instruction template for the architect role

### Changed
- **SonarQube full cleanup**: resolved all 205 open issues (CRITICAL, MAJOR, MINOR) — 0 remaining
- **Cognitive complexity refactoring**: orchestrator.js (345→15), display.js (134→2), server-handlers.js (101→3), config.js (55→10), and 14 other files
- **Handler dispatch maps**: replaced large switch/if-else chains with object dispatch maps in display.js, server-handlers.js, and config.js
- **MCP server**: migrated from deprecated `Server` to `McpServer` class
- **Modern JS**: replaceAll, RegExp.exec, Number.parseInt, Set.has, structuredClone across 50+ files

## [1.16.0] - 2026-03-11

### Added
- **DiscoverRole**: new pre-execution validation role that analyzes tasks for gaps, ambiguities, and missing information before pipeline execution
- **5 discovery modes**: `gaps` (default gap detection), `momtest` (Mom Test question generation), `wendel` (behavior change adoption checklist), `classify` (START/STOP/DIFFERENT classification), `jtbd` (Jobs-to-be-Done generation)
- **`kj_discover` MCP tool**: standalone gap detection tool with mode, context, and Planning Game task integration
- **Pipeline integration**: discover runs as opt-in pre-pipeline stage before triage (`--enable-discover` flag or `pipeline.discover.enabled` config)
- **Non-blocking discovery**: discover failures log warnings and continue pipeline execution gracefully

## [1.15.0] - 2026-03-11

### Added
- **Triage taskType classification**: triage now classifies tasks as sw, infra, doc, add-tests, or refactor for policy-driven pipeline gating
- **`--taskType` parameter**: explicit taskType override for `kj_run` CLI and MCP tool, bypasses triage classification
- **Mandatory triage**: triage always runs to classify taskType; can activate roles but respects pipeline config for explicitly enabled roles
- **Triage → policy integration**: taskType from triage feeds into policy-resolver (priority: flags > config > triage > default sw)

## [1.14.0] - 2026-03-11

### Added
- **Policy resolver**: new `src/guards/policy-resolver.js` module maps taskType (sw, infra, doc, add-tests, refactor) to pipeline policies (tdd, sonar, reviewer, testsRequired) with per-project config overrides
- **Pipeline policy gating**: orchestrator applies resolved policies to gate TDD, SonarQube, and reviewer stages based on taskType, emits `policies:resolved` event
- **Config immutability**: policy gates use shallow copies, never mutating the caller's config object

## [1.13.2] - 2026-03-10

### Fixed
- **npm bin entries removed during publish**: npm 11.x rejected `bin` entries pointing directly to `src/`. Created proper wrapper scripts in `bin/kj` and `bin/karajan-mcp` that delegate to the source files

## [1.13.1] - 2026-03-10

### Fixed
- **Claude subprocess incompatible with Claude Code v2.1.71**: `--print` combined with `--output-format stream-json` now requires `--verbose` flag. Added `--verbose` to both `runTask` (streaming) and `reviewTask` in `ClaudeAgent`

## [1.13.0] - 2026-03-08

### Added
- **BecarIA Gateway integration**: full CI/CD integration with GitHub PRs via repository_dispatch events. PRs become the source of truth for the pipeline
- **Early PR creation**: PR created after first coder iteration (before reviewer), subsequent iterations push incrementally
- **All-agent dispatch comments**: Sonar, Solomon, Tester, Security, Planner, Coder, and Reviewer all post comments on the PR with their results
- **Formal PR reviews**: Reviewer dispatches APPROVE/REQUEST_CHANGES via becaria-review event
- **Configurable dispatch**: custom event types (`review_event`, `comment_event`) and optional `[Agent]` prefix via `becaria` config section
- **PR-based review**: Reviewer reads `gh pr diff` instead of local `git diff` when BecarIA is enabled
- **`kj review` standalone with BecarIA**: reads PR diff, dispatches review result, errors if no open PR
- **Repo and PR auto-detection**: `detectRepo()` parses SSH/HTTPS remotes, `detectPrNumber()` uses `gh pr view`
- **BecarIA workflow templates**: `becaria-gateway.yml`, `automerge.yml`, `houston-override.yml` embedded in package
- **`kj init --scaffold-becaria`**: copies workflow templates to `.github/workflows/`
- **`kj doctor` BecarIA checks**: verifies workflows, gh CLI, and GitHub secrets when BecarIA enabled
- **`--enable-becaria` flag**: CLI and MCP support, auto-enables git automation (commit + push + PR)
- 50 new tests for BecarIA modules (1230 total across 111 test files)

## [1.12.0] - 2026-03-07

### Added
- **Intelligent reviewer mediation**: when the reviewer flags out-of-scope issues (files not in the diff), the scope filter auto-defers them instead of blocking the pipeline. Deferred issues are tracked as technical debt in the session and injected into the coder prompt as context
- **Deferred issues tracking**: out-of-scope reviewer concerns are stored in `session.deferred_issues` with structured metadata (file, severity, description, suggested_fix). Returned in `deferredIssues` field of the session result for follow-up task creation
- **Solomon mediation on reviewer stall**: when `RepeatDetector` detects a stalled reviewer (same issues repeated), Solomon now arbitrates before stopping — can override, continue with guidance, or create subtask. Falls back to pause only if Solomon can't resolve
- **Solomon rule: reviewer_overreach**: new rule detects when the reviewer consistently flags out-of-scope issues that get auto-demoted by the scope filter
- **Deferred context in coder prompt**: the coder receives a "Deferred reviewer concerns" section listing tracked tech debt, so it can naturally address issues if its changes touch the relevant areas
- 4 new tests for scope filter and deferred context (1196 total)

## [1.11.1] - 2026-03-07

### Fixed
- **Claude subprocess blocked on permissions**: `claude -p` runs non-interactively (`stdin: "ignore"`) but without `--allowedTools`, it blocks waiting for permission approval that never arrives. Now passes `--allowedTools Read Write Edit Bash Glob Grep` to both `runTask` and `reviewTask`

## [1.11.0] - 2026-03-07

### Added
- **Rate-limit standby with auto-retry**: when a coder/reviewer hits a rate limit, Karajan now parses the cooldown time (5 message patterns supported), waits with exponential backoff (5min default, 30min max, 5 retries), then auto-resumes. Emits standby/heartbeat/resume events for real-time monitoring
- **Preflight handshake**: `kj_preflight` tool requires human confirmation of agent config before `kj_run`/`kj_code`. Prevents AI from silently overriding agent assignments. Supports natural language ("use gemini as coder")
- **Session-scoped agent config**: `kj_agents` via MCP defaults to session scope (in-memory, dies with server restart). CLI defaults to project scope. Both override global config
- **Pipeline intelligence — triage as pipeline director**: triage analyzes task complexity and returns role activation decisions (tester, security, refactorer, researcher). Enabled by default
- **Tester and security enabled by default**: pipeline now runs tester and security checks unless explicitly disabled
- **Solomon supervisor**: runs after each iteration with 4 rules (max_files_per_iteration, max_stale_iterations, dependency_guard, scope_guard). Pauses on critical alerts and asks for human input
- **3-tier config merge**: DEFAULTS < global (~/.karajan/) < project (.karajan/)
- **MCP progress streaming for kj_code/kj_review/kj_plan**: `notifications/progress` now sent by all direct handlers (was only kj_run). Hosts that support progressToken (like Claude Code) show real-time stage progress
- **Enhanced kj_status**: returns parsed status summary (currentStage, currentAgent, iteration, isRunning, recent errors) alongside raw log lines
- **kj-tail resilient tracking**: uses `tail -F` instead of `tail -f` to survive log file truncation across runs
- ADR documenting MCP progress notification investigation
- 76 new tests (1180 total across 106 test files)

## [1.10.1] - 2026-03-07

### Added
- **Planning Game auto-status in `runFlow`**: when `pgTaskId` is provided, Karajan now automatically marks the PG card as "In Progress" (with `startDate`, `developer: BecarIA`) at session start, and "To Validate" (with `endDate`, `commits`) on approved completion. Works from both CLI and MCP — no duplicate logic needed
- 6 new tests for PG integration (1090 total)

### Changed
- **CLI `run.js` simplified**: PG card fetch and completion update logic moved to `runFlow` (was duplicated in CLI handler)

## [1.10.0] - 2026-03-07

### Added
- **`kj_agents` MCP tool and CLI command**: list or change AI agent assignments per role on the fly. `kj_agents set coder gemini` persists to `kj.config.yml` — no restart needed, next `kj_run`/`kj_code` picks it up immediately
- **`kj doctor` version display**: first line now shows Karajan Code version (`OK   Karajan Code: v1.10.0`)
- **Subprocess constraints in coder prompt**: tells the coder it runs non-interactively (no stdin/TTY), must use `--yes`/`--no-input` flags for CLI wizards, and report clearly if a task cannot be done non-interactively
- 10 new tests (1084 total)

### Fixed
- **Checkpoint null response no longer kills sessions**: when `elicitInput` fails or the AI agent returns null/empty, the session now continues for 5 more minutes instead of stopping. Only an explicit "4" or "stop" triggers a session stop
- **`kj_resume` accepts stopped and failed sessions**: previously only "paused" sessions could be resumed. Now stopped (checkpoint) and failed (timeout/max-iterations) sessions can be re-run with `kj_resume`

## [1.9.6] - 2026-03-06

### Fixed
- **Claude subprocess compatibility**: Fixed three issues preventing `claude -p` from working as a subprocess in Node.js: (1) strip `CLAUDECODE` env var to bypass nesting guard, (2) detach stdin (`stdin: "ignore"`) to prevent blocking on inherited parent stdin, (3) read structured output from stderr where Claude Code 2.x writes it instead of stdout. Also changed `reviewTask` to use `stream-json` for real-time feedback.
- **Config default test**: fixed flaky `max_iteration_minutes` test that read the local `kj.config.yml` instead of testing the hardcoded default

## [1.9.4] - 2026-03-06

### Fixed
- **Branch guard for MCP tools**: `kj_run`, `kj_code`, and `kj_review` now reject execution when on the base branch (main). The diff against `origin/main` is empty on the same branch, making the reviewer stage useless. A clear error message instructs AI agents to create a feature branch first.

### Added
- New `branch_error` category in MCP error classification with actionable suggestion

## [1.9.3] - 2026-03-04

### Added
- **Planner hard runtime cap**: new `session.max_planner_minutes` (default 60) to stop noisy-but-stuck planner runs that still emit output (e.g. reconnect loops)

### Changed
- **Codex prompt transport hardening**: `CodexAgent` now sends prompts through stdin (`codex exec -`) instead of argv to handle very large planner prompts more reliably
- **Planner timeout wiring in all entrypoints**: `kj_plan` (MCP), `PlannerRole`, and CLI `kj plan` now pass both silence and runtime timeouts to agent execution
- **Docs updated**: README + troubleshooting (EN/ES) now document `max_planner_minutes` behavior and tuning guidance

## [1.9.2] - 2026-03-04

### Added
- **Planner anti-stall guardrails**: configurable `session.max_agent_silence_minutes` (default 20) to stop planner executions that remain silent for too long
- **Richer heartbeat telemetry**: heartbeat events are now emitted continuously, including `silenceMs` and wait/active status, so long-running calls remain observable
- **Repeated stall notifications**: warning/critical stall events are re-emitted periodically during prolonged silence (instead of a single warning)
- **Robust stream parsing in process runner**: `runCommand` now handles `CR`, `LF`, and `CRLF` separators and flushes partial output buffers periodically for CLIs that do not terminate lines

### Changed
- **`kj_plan` diagnostics** now include max-silence configuration at start and append runtime stats (`lines`, `bytes`, `elapsed`) on planner failure to speed up troubleshooting
- **MCP error classification** includes `agent_stall` with actionable guidance (`kj_status`, smaller prompt, or increase silence timeout)

## [1.9.1] - 2026-03-03

### Added
- **`kj update` CLI command**: checks npm for the latest version and runs `npm install -g karajan-code@latest` to self-update

## [1.9.0] - 2026-03-03

### Added
- **Real-time feedback for all pipeline stages**: planner, triage, researcher, and refactorer now propagate `onOutput` callbacks, providing live progress during execution
- **Stall detector** (`src/utils/stall-detector.js`): monitors agent activity with heartbeat (30s), warning (2min), and critical (5min) thresholds to detect hung agents
- **File-based run log** (`src/utils/run-log.js`): writes real-time progress to `<projectDir>/.kj/run.log`, monitorable with `tail -f` or `kj_status`
- **`kj_status` MCP tool**: reads the current run log so Claude can show what Karajan is doing in real-time
- **Stream-JSON for Claude CLI**: when `onOutput` is provided, uses `--output-format stream-json` to get real-time NDJSON streaming instead of buffered text output
- **MCP roots-based project directory detection**: uses `server.listRoots()` to resolve the user's project directory instead of `process.cwd()`, fixing run.log placement when MCP runs from a different directory
- New progress event types: `agent:heartbeat`, `agent:stall`, `triage:start/end`, `researcher:start/end`
- 9 new tests for stall detector (1053 total)

## [1.8.0] - 2026-03-02

### Added
- **Pipeline stage tracker**: new `pipeline:tracker` event emitted after every stage transition during `kj_run`, carrying full cumulative state (done/running/pending/failed) for all pipeline stages
- **Single-agent progress logging**: `kj_code`, `kj_review`, and `kj_plan` now emit tracker start/end logs so MCP hosts can show which agent is running
- **CLI pipeline rendering**: `kj run` displays a cumulative pipeline box with status icons per stage
- New exported helpers: `buildPipelineTracker(config, emitter)` and `sendTrackerLog(server, stageName, status, summary)`
- 12 new tests (1044 total)

## [1.7.0] - 2026-03-02

### Fixed
- **kj_plan/kj_code/kj_review SIGKILL timeout**: these three MCP tools were spawned as subprocesses via execa. When the caller passed `timeoutMs`, execa killed the subprocess with SIGKILL. They now execute in-process (like `kj_run`), with no timeout — the agent runs until done
- **MCP server stale after update**: after `npm link`/`npm install`, the MCP process kept running old ESM-cached code. Added `setupVersionWatcher` that detects `package.json` version changes and exits cleanly so Claude Code restarts the server with fresh code. Also added per-call version check as fallback
- **Hardcoded versions**: replaced hardcoded version strings in `cli.js` (`"1.6.2"`), `display.js` (`"0.1.0"`), and `server.js` (`"1.0.0"`) with dynamic reads from `package.json`

### Changed
- `timeoutMs` parameter removed from `kj_code`, `kj_review`, `kj_plan` MCP tool schemas
- MCP server now reports its actual package version in the `Server` constructor
- 5 new tests (1030 total)

## [1.6.2] - 2026-03-02

### Fixed
- **Init wizard skipped config questions with single agent**: when only one AI agent was installed, `kj init` auto-assigned it to all roles and exited without asking about triage, SonarQube, or methodology. Now all config questions are always asked regardless of agent count

## [1.6.1] - 2026-03-02

### Fixed
- **Agent subprocess timeout removed**: all 4 agent implementations (Claude, Codex, Gemini, Aider) had a hardcoded timeout of `max_iteration_minutes` (default 30 min) that killed the subprocess with SIGKILL. This was the actual cause of the "31 min timeout" — the orchestrator-level fix in v1.6.0 was incomplete. Agents now run without timeout; the orchestrator manages time via interactive checkpoints (MCP) or hard timeout (CLI)

## [1.6.0] - 2026-03-02

### Added
- **Interactive timeout checkpoints**: replaces the hard timeout that killed running processes. Every 5 minutes (configurable with `--checkpoint-interval`), pauses execution with a progress report and asks the user to continue (5 more min / until done / custom time / stop). Only applies when `askQuestion` is available (MCP `kj_run`); subprocess commands (`kj_code`, `kj_review`) run without timeout by default
- **PG subtask creation from triage decomposition**: when triage recommends decomposing a task and a Planning Game card is linked, offers to create subtask cards in PG with `blocks/blockedBy` chain relationships for sequential execution
- **Triage task decomposition**: triage now analyzes whether tasks should be split, returning `shouldDecompose` and `subtasks[]` fields with up to 5 actionable subtask descriptions
- **Planner receives triage decomposition**: planner prompt includes triage decomposition context, focusing the plan on the first subtask with remaining subtasks documented as `pending_subtasks`
- **PR body enrichment**: auto-generated PR body includes approach, implementation steps, and pending subtasks as checkboxes from triage decomposition
- **Planning Game card traceability**: session reports now include `pg_task_id`/`pg_project_id`, with `--pg-task` filtering support in `kj report` and MCP `kj_report`
- **Provider and model in checkpoints**: all session checkpoints now record which provider and model were used for each stage
- PG HTTP client methods: `createCard()` and `relateCards()` for card creation and relationship management
- CLI flag: `--checkpoint-interval <n>` to control minutes between interactive checkpoints
- MCP parameter: `checkpointInterval` for `kj_run`
- 61 new tests (1025 total)

### Fixed
- **Timeout regression**: removed the forced timeout in `run-kj.js` that prevented tasks from completing. Subprocess timeout now only applies when explicitly set via `timeoutMs`
- Timeout race condition between MCP host and agent subprocess resolved

### Changed
- `session.checkpoint_interval_minutes` default: 5 (previously hard timeout at 30 min)
- Subprocess timeout behavior: no timeout by default (was always imposed via `resolveTimeout()`)

## [1.5.0] - 2026-03-01

### Added
- **Smart model selection**: automatically selects optimal model per role based on triage complexity level — trivial/simple tasks use lighter models (haiku, flash, o4-mini), complex tasks use powerful models (opus, o3, pro)
- CLI flags: `--smart-models` / `--no-smart-models` to enable/disable smart model selection
- MCP parameter: `smartModels` for `kj_run`
- New module `src/utils/model-selector.js` with configurable tier maps and role overrides
- User-configurable tiers and role overrides via `model_selection` in `kj.config.yml`
- Reviewer role override: always uses at least "medium" tier for review quality
- Triage role override: always uses lightweight models regardless of task complexity
- 34 new tests (964 total)

### Changed
- `model_selection.enabled: true` by default — smart selection activates automatically when triage is enabled
- Explicit `--coder-model` / `--reviewer-model` flags always take precedence over smart selection

## [1.4.0] - 2026-03-01

### Added
- **Auto-fallback to available agent**: when the primary agent hits a rate limit, Karajan automatically falls back to another available agent for the same role (#66)
- 7 new tests (930 total)

## [1.3.0] - 2026-03-01

### Added
- **Rate limit detection**: detects CLI agent rate limits (Claude, Codex) and pauses the session instead of failing, allowing resumption when the token window resets (#65)
- 5 new tests (923 total)

## [1.2.0] - 2026-02-28

### Added
- **`kj report --trace`**: chronological pipeline stage breakdown with per-stage provider, duration, tokens in/out, and cost in USD/EUR (#55)
- **`kj init` interactive wizard**: auto-detects installed agents (claude, codex, gemini, aider) and guides configuration; single agent auto-assigns all roles without prompting (#56)
- **`kj roles` command**: list pipeline roles with provider/status or show `.md` template instructions; supports custom project overrides (#57)
- MCP tool `kj_roles` with `list`/`show` actions
- CLI flags: `--trace`, `--currency` for report; `--no-interactive` for init
- Budget config: `budget.currency` and `budget.exchange_rate_eur` defaults
- Shared `agent-detect` module extracted from `doctor` for reuse in `init`
- 41 new tests (762 total)

## [1.1.0] - 2026-02-28

### Added
- **Dynamic triage pipeline**: `TriageRole` classifies task complexity (trivial/simple/medium/complex) and activates only necessary pipeline roles (#53)
- **Optional Serena MCP integration**: symbol-level code navigation (`find_symbol`, `find_referencing_symbols`, `insert_after_symbol`) injected into coder/reviewer prompts when `serena.enabled=true` (#54)
- CLI flags: `--enable-triage`, `--enable-serena`, `--enable-reviewer`, `--enable-researcher`, `--enable-tester`, `--enable-security`
- MCP parameters: `enableTriage`, `enableSerena`, `enableReviewer`, `enableResearcher`, `enableTester`, `enableSecurity`
- Serena availability check in `kj doctor`
- 17 new tests (721 total)

### Changed
- Reviewer is now conditionally skippable via triage or `--enable-reviewer=false`
- Pipeline role flags (planner, refactorer, researcher, tester, security) now validated in `requiredRolesFor()`

## [1.0.0] - 2026-02-28

### Added
- `package.json` metadata for npm publish (repository, keywords, engines, author, license, files)
- `SECURITY.md` with vulnerability reporting policy
- `CHANGELOG.md` following Keep a Changelog format
- Pre-commit hook blocking LLM attribution in commits (`.githooks/pre-commit`)
- `RefactorerRole` class with BaseRole lifecycle (`src/roles/refactorer-role.js`)
- Refactorer role template (`templates/roles/refactorer.md`)
- Per-model pricing module (`src/utils/pricing.js`) with `calculateUsageCostUsd`, `mergePricing`, and `DEFAULT_MODEL_PRICING`
- Installer end-to-end validation (#52)

### Fixed
- SonarQube host URL in token setup instructions (#52)
- Missing files from orchestrator pipeline (pricing, refactorer role, refactorer template)

## [0.2.0] - 2026-02-27

### Added
- Per-model pricing table for accurate budget tracking in USD (#49)
- `kj report` command with session export and `--format json` (#50)
- Model selection flags `--coder-model`, `--reviewer-model`, `--planner-model` per role (#45)
- Planning-game client with timeout, network error, and JSON parse handling (#46)
- `buildTaskPrompt` and `updateCardOnCompletion` in planning-game adapter (#46)
- Configurable SonarQube settings: container name, volumes, network, timeouts (#47)
- Support for external SonarQube with `sonarqube.external=true` (#47)
- `RefactorerRole` export and template verification (#48)

### Fixed
- `coderModel` flag no longer leaks into other roles' model selection (#45)

## [0.1.0] - 2026-02-24

### Added
- **Core orchestrator**: coder -> sonar -> reviewer loop with configurable iterations
- **CLI commands**: `init`, `config`, `run`, `code`, `review`, `scan`, `doctor`, `plan`, `resume`, `sonar`
- **4 AI agents**: Claude, Codex, Gemini, Aider with auto-detection
- **10 pipeline roles**: Planner, Coder, Refactorer, Reviewer, Tester, Security, Researcher, Sonar, Solomon, Commiter
- **BaseRole abstraction** with standardized lifecycle (init -> execute -> report)
- **Role .md templates** with custom instruction support per project
- **SonarQube integration**: Docker management, quality gates, enforcement profiles
- **TDD-by-default** methodology with test change enforcement
- **Review profiles**: standard, strict, paranoid, relaxed, custom
- **Budget tracking**: token and cost tracking per session
- **Planning Game MCP integration**: task context and completion updates
- **MCP server** with 10 tools and real-time progress notifications
- **Session management**: pause/resume, fail-fast detection, activity logging
- **Git automation**: auto-commit, auto-push, auto-PR, auto-rebase
- **Streaming output**: real-time agent output in CLI and MCP
- **Solomon arbitration**: conflict resolution between AI agents
- **Interactive installer**: one-command setup with multi-instance support
- **CI/CD**: GitHub Actions workflow with validation and PR annotations
- **716+ unit tests** with Vitest

[Unreleased]: https://github.com/manufosela/karajan-code/compare/v1.56.0...HEAD
[1.56.0]: https://github.com/manufosela/karajan-code/compare/v1.55.0...v1.56.0
[1.55.0]: https://github.com/manufosela/karajan-code/compare/v1.54.0...v1.55.0
[1.54.0]: https://github.com/manufosela/karajan-code/compare/v1.53.1...v1.54.0
[1.53.1]: https://github.com/manufosela/karajan-code/compare/v1.53.0...v1.53.1
[1.53.0]: https://github.com/manufosela/karajan-code/compare/v1.52.0...v1.53.0
[1.52.0]: https://github.com/manufosela/karajan-code/compare/v1.51.0...v1.52.0
[1.51.0]: https://github.com/manufosela/karajan-code/compare/v1.50.1...v1.51.0
[1.50.1]: https://github.com/manufosela/karajan-code/compare/v1.50.0...v1.50.1
[1.50.0]: https://github.com/manufosela/karajan-code/compare/v1.49.0...v1.50.0
[1.49.0]: https://github.com/manufosela/karajan-code/compare/v1.48.0...v1.49.0
[1.48.0]: https://github.com/manufosela/karajan-code/compare/v1.47.0...v1.48.0
[1.47.0]: https://github.com/manufosela/karajan-code/compare/v1.46.0...v1.47.0
[1.46.0]: https://github.com/manufosela/karajan-code/compare/v1.45.0...v1.46.0
[1.45.0]: https://github.com/manufosela/karajan-code/compare/v1.44.0...v1.45.0
[1.44.0]: https://github.com/manufosela/karajan-code/compare/v1.43.0...v1.44.0
[1.43.0]: https://github.com/manufosela/karajan-code/compare/v1.42.0...v1.43.0
[1.42.0]: https://github.com/manufosela/karajan-code/compare/v1.41.0...v1.42.0
[1.41.0]: https://github.com/manufosela/karajan-code/compare/v1.40.0...v1.41.0
[1.40.0]: https://github.com/manufosela/karajan-code/compare/v1.39.0...v1.40.0
[1.39.0]: https://github.com/manufosela/karajan-code/compare/v1.38.2...v1.39.0
[1.38.2]: https://github.com/manufosela/karajan-code/compare/v1.38.1...v1.38.2
[1.38.1]: https://github.com/manufosela/karajan-code/compare/v1.38.0...v1.38.1
[1.38.0]: https://github.com/manufosela/karajan-code/compare/v1.37.0...v1.38.0
[1.37.0]: https://github.com/manufosela/karajan-code/compare/v1.36.1...v1.37.0
[1.36.1]: https://github.com/manufosela/karajan-code/compare/v1.36.0...v1.36.1
[1.36.0]: https://github.com/manufosela/karajan-code/compare/v1.35.0...v1.36.0
[1.35.0]: https://github.com/manufosela/karajan-code/compare/v1.34.4...v1.35.0
[1.34.4]: https://github.com/manufosela/karajan-code/compare/v1.34.3...v1.34.4
[1.34.3]: https://github.com/manufosela/karajan-code/compare/v1.34.2...v1.34.3
[1.34.2]: https://github.com/manufosela/karajan-code/compare/v1.20.0...v1.34.2
[1.13.2]: https://github.com/manufosela/karajan-code/compare/v1.13.1...v1.13.2
[1.13.1]: https://github.com/manufosela/karajan-code/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/manufosela/karajan-code/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/manufosela/karajan-code/compare/v1.11.1...v1.12.0
[1.11.1]: https://github.com/manufosela/karajan-code/compare/v1.11.0...v1.11.1
[1.11.0]: https://github.com/manufosela/karajan-code/compare/v1.10.1...v1.11.0
[1.10.1]: https://github.com/manufosela/karajan-code/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/manufosela/karajan-code/compare/v1.9.6...v1.10.0
[1.9.6]: https://github.com/manufosela/karajan-code/compare/v1.9.4...v1.9.6
[1.9.3]: https://github.com/manufosela/karajan-code/compare/v1.9.2...v1.9.3
[1.9.2]: https://github.com/manufosela/karajan-code/compare/v1.9.1...v1.9.2
[1.8.0]: https://github.com/manufosela/karajan-code/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/manufosela/karajan-code/compare/v1.6.2...v1.7.0
[1.6.2]: https://github.com/manufosela/karajan-code/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/manufosela/karajan-code/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/manufosela/karajan-code/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/manufosela/karajan-code/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/manufosela/karajan-code/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/manufosela/karajan-code/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/manufosela/karajan-code/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/manufosela/karajan-code/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/manufosela/karajan-code/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/manufosela/karajan-code/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/manufosela/karajan-code/releases/tag/v0.1.0
