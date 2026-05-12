---
title: Architecture History
description: How Karajan Code's architecture has evolved over time.
---

This page documents the major architectural decisions and how Karajan Code evolved from a simple shell script orchestrator to a modular, multi-agent pipeline.

## Phase 66: Patch — Self-fix convergence guard + async-deps respect (v2.14.1)

**v2.14.1** (patch, 2026-05-12) — 2 PRs absorbiendo las patologías del planner que el dogfooding de v2.14.0 contra GRETA Plan 2 reveló a las pocas horas de release.

**Self-fix loop divergence** (`KJC-BUG-0046` / P5, #684): el self-fix loop introducido en v2.14.0 podía empeorar el plan en lugar de mejorarlo. El dogfooding mostró que iter 1 reducía 15→10 issues pero iter 2 borraba HUs que iter 1 había añadido, dejando referencias dangling que el reviewer post-iter-2 contaba como nuevos `missing_dependencies`, terminando en 17 findings — peor que antes de iter 2. Fix: snapshot del plan (`JSON.parse(JSON.stringify(plan.hus))` + `plan.review`) ANTES de aplicar cada patch del fixer. Tras re-review, si `newCount > currentCount`, restaurar el snapshot y `break` el loop. Log nuevo en `run.log`: `[planner] self-fix iter 2 regressed (10 → 17) — reverted, stopping`. La cota inferior queda fijada en `min(reviews observados)` en lugar del último review.

**Async-deps respect** (`KJC-BUG-0047` / P6, #685): el planner convertía sistemáticamente "Y reacciona a X" en `X blocked_by Y`, rompiendo el principio "AVISA-no-BLOQUEA" que GRETA define para sus guardarraíles. Ejemplo del Plan 2: 4 de 5 order_issues del reviewer eran del mismo patrón ("041 Outcome blocked_by 052 Guardarraíl 1 — pero G1 es async y NO bloquea creación"). Fix: regla explícita añadida a la sección `dependencies` del prompt del planner enumerando 6 patrones de async observers — (a) guardrails/validators/monitors, (b) cron jobs / scheduled tasks, (c) webhooks / event handlers / listeners, (d) async queues / workers / pipelines, (e) audit logs / metric collectors, (f) "validator" / "monitor" steps que corren después — junto con una heurística clara: "¿X CONSUME un deliverable que debe EXISTIR antes de X empezar?" → `blocked_by`. "¿Y solo REACCIONA a X después?" → NO `blocked_by`, paralelos.

**Resultado del dogfooding**: regenerar Plan 2 GRETA contra v2.14.1 devuelve **9 findings sobre 58 HUs** (15% issue density), igualando el baseline iter 1 de v2.13.0 + #661-#664. v2.14.0 puro devolvía 17 findings. Reducción del 47% en findings iniciales gracias a P6 (15→9 antes de cualquier iter del fixer); P5 evita que cualquier iter posterior empeore el resultado. Las 9 patologías restantes son gaps reales del SPEC (`dimension_link` no cubierto, envelope encryption del `reasoning` IA emocional faltante, cascada GDPR sin algunas deps implícitas), no fallos del planner — son ediciones manuales tras revisión.

## Phase 65: Quality pass — Solomon classification + planner self-fix + tests reorg (v2.14.0)

**v2.14.0** (minor, 2026-05-12) — 16 PRs en una sesión absorbiendo bugs blockers, patologías del planner detectadas en el dogfooding de Plan 2 GRETA, hardening del HU Board, y la primera tanda de reorg de `tests/` (issue #368). Suite 4577/4577 verde toda la sesión, 0 regresiones.

**Solomon ya no aprueba security blockers erróneamente clasificados como "style"** (`KJC-BUG-0026`, #665): la Rule 6 (`reviewer_style_block`) clasificaba cualquier issue con severity `low`/`minor` O regex de keywords cosméticas (`name`, `format`, `documentation`, …) como style. Issues de seguridad legítimos con esas características (e.g. "SQL injection in user input parsing" matcheaba `name`, "Missing CORS documentation" matcheaba `documentation`) acababan en el ojo de Solomon que los aprobaba. Fix: anti-clasificador `isSecurityIssue()` con tres señales — severities `critical`/`high`/`blocker`/`major`, categorías `security`/`correctness`/`bug`/`vulnerability`, y una regex de security keywords (sql injection, xss, csrf, ssrf, rce, auth, password, secret, credential, token, hash, crypto, traversal, prototype pollution, deserializ, eval, …). Si CUALQUIERA de las señales matchea, la lambda devuelve `false` para `allStyle` y Solomon no se invoca.

**Detector de fs-leak del coder, segunda capa** (`KJC-BUG-0032`, #666): el `fs-leak-detector` original snapshotteaba `$HOME` antes/después del coder y diffeaba top-level entries. Capturaba el incidente original (`cd /home/manu/assistant && pnpm init` creando 36 MB) sólo porque `~/assistant` era nuevo. Si el target preexistía, pasaba inadvertido. Fix: nueva función `detectTranscriptCdLeaks(transcript, projectDir)` que escanea el output del coder buscando patrones `cd <ruta-abs> && <write-cmd>` con `<ruta-abs>` fuera de `projectDir` y `<write-cmd>` en el set de creación (`mkdir`, `touch`, `cp`, `mv`, `git init`, `{pnpm,npm,yarn} init/create`, `npx create-*`, `cat >`, `echo >`, redirects). Pure-read commands (`ls`, `which`, `grep`) no flagean. `/tmp` exento. Las dos capas se unifican en `coder-stage.js`; si cualquiera detecta leak, `formatLeakMessage()` aborta la iteración.

**Patologías del planner P1-P4 detectadas en dogfooding de Plan 2 GRETA** (2026-05-11): el reviewer flagaba sistemáticamente 4 huecos del SPEC en cada iteración. P1 (#667 / `KJC-BUG-0042`) — el planner ignoraba declaraciones explícitas tipo "NO incluye en este plan: vistas compartidas, X, Y", "Out of scope: real-time sync", "Plan N handles: cross-tenant views". Fix: `extractScopeExclusions(task)` detecta 6 patrones (ES + EN) y renderiza una sección **FORBIDDEN scope** en el prompt con instrucción "do NOT generate steps for these items". P2 (#668 / `KJC-BUG-0043`) — el planner no inferia deps transversales uno-a-muchos: una HU con AC "listado transversal de warnings filtrables por guardrail" solo declaraba `dependencies: [GUARD-001]` cuando debía depender de `GUARD-001..N`. Fix: regla explícita en el prompt — "if a step requires ALL members of a category, declare deps to ALL of them, NOT just the first" + ejemplo concreto. P3 (#669 / `KJC-BUG-0044`) — el planner reimplementaba funcionalidad ya cubierta por otra HU. Fix: nuevo campo `reuse: ["<id>"]` end-to-end (prompt schema + `addHu`/`removeHu`/`updateHu` + pass-2 de resolución en `generate.js`). P4 (#670/#671 / `KJC-BUG-0045`) — el plan-reviewer era flag-only: surfaceaba `missing_hus`/`missing_dependencies`/`scope_overlaps` y los dejaba para que el usuario los aplicara a mano. Fix: nuevo módulo `src/plan/plan-fixer.js` con `buildFixerPrompt({ task, hus, findings })` que pide al planner un patch estructurado, `applyReviewerFeedback({ agent, ... })` que ejecuta el agent + parsea + normaliza, y `applyFixerPatch(plan, patch)` que muta el plan in-place (`additions` → `addHu`, `deletions` → `removeHu` con cleanup de dangling refs, `deps_to_add` → merge `blocked_by` sin duplicar). Loop max=2 iteraciones tras `reviewPlan`, opt-out con `--no-plan-fixer`/`--quick`.

**HU Board polish**: prompts zombi (`KJC-BUG-0038`, #673) — si el runner crasheaba sin contestar a `askQuestion`, el archivo `~/.kj/prompts/<id>.json` quedaba huérfano y cada reload del board mostraba el modal "Karajan needs an answer" sin runner detrás. Fix: TTL de 30 min en `GET /api/prompts`. Si `parsed.createdAt` (con fallback a `mtime`) es más viejo, `unlink` + `addTombstone` + skip. Rate-limit (`KJC-BUG-0039`, #674) — el rate-limit estaba en 300 req/min por IP; el fanout del primer load del board + múltiples tabs + reconnects SSE podían sobrepasarlo y devolver 429 al usuario en su primer click. Fix: default 300→600 con env var `HU_BOARD_RATE_LIMIT` para override + `skip:` para `/api/events` (SSE es 1 conexión persistente, reconnects automáticos del browser no deberían contar).

**Tests reorg (issue #368, parcial)**: el directorio `tests/` tenía 264 archivos en root sin estructura clara. 5 PRs (#675–#679) movieron 93 archivos a 13 subcarpetas espejo de `src/` (`tests/plan/`, `tests/hu/`, `tests/sonar/`, `tests/board/`, `tests/session/`, `tests/triage/`, `tests/domain/`, `tests/agents/`, `tests/brain/`, `tests/reviewer/`, `tests/security/`, `tests/utils/`, `tests/coder/`, `tests/solomon/`, `tests/skills/`, `tests/roles/`). Cambios mecánicos: `git mv` (preserva history como rename) + `sed` para 6 patrones de imports relativos (`from "../src"` → `"../../src"`, `vi.mock`, `vi.doMock`, `import()`, `./fixtures` → `../fixtures`, `import.meta.dirname, ".."` con `templates/` path.resolve). Quedan ~170 archivos en root para próximas oleadas.

## Phase 64: HU Board hardening — tombstones + restart detector + cleanup (v2.13.0)

**v2.13.0** (minor, 2026-05-11) — Cinco PRs absorben las patologías que la sesión de dogfooding del 2026-05-10 reveló sobre el HU Board: un modal "Karajan needs an answer" del 7 de mayo bloqueando toda la UI, ~18 proyectos zombi reapareciendo tras cada `kj board start`, el navegador sirviendo HTML/JS antiguo tras un `kj board stop` + `start`, y el modal del prompt mostrando transparencia porque `var(--bg-secondary)` jamás se declaró. No band-aids — refactor estructural por causa raíz.

**Tombstones — delete persistente** (`KJC-TSK-0380`, #655/#656/#657): el HU Board reconstruye la DB SQLite desde el filesystem en cada `fullScan`, así que cualquier `DELETE` por API era silenciosamente revertido al siguiente sync de chokidar. Solución: tabla `tombstones (resource_type, resource_id, deleted_at, source, fs_paths)` con clave primaria compuesta. Los `sync*File` consultan tombstone antes de upsert; si está, hacen `rm -rf` del path del filesystem y abortan. Patrón clásico de Cassandra/Riak. Permanentes; restauración explícita vía endpoint. Endpoints DELETE reforzados (`/api/projects/:id`, `/api/stories/:id`, `/api/sessions/:id`) y nuevos (`DELETE /api/prompts/:id`, `DELETE /api/plans/:planId`, `GET /api/tombstones`, `POST /api/tombstones/:type/:id/restore`). Comando nuevo `kj board cleanup` detecta proyectos efímeros (`tmp_*`/`test_*`/`demo_*`/`kj-test-*`/`s_*`/`plan-*` con >7d sin actividad), prompts huérfanos (sin `.answer.json` y mtime >24h) y directorios de sesión huérfanos. Soporta `--dry-run`. Resuelve los ~20 zombis acumulados en una sola pasada.

**Server-restart detector** (`KJC-TSK-0379`, #654): `Cache-Control: no-store, must-revalidate` para HTML/JS/CSS servidos por el board (ETag y Last-Modified desactivados) garantiza que el primer request tras un restart trae código fresco. El cliente polea `/api/version` cada 30s; si `boot_time` cambia (server reiniciado), `forceRefresh()` automático: limpia caches y recarga sin que el usuario tenga que cerrar pestañas o hacer Clear Site Data. Botón **🧹** en el header como escotilla manual visible.

**Polish UX** (#658): `var(--bg-secondary)` referenciada en 8 sitios de `app.js` (modal del prompt, textareas, inputs, code blocks) pero jamás declarada en `:root` → fallback a `transparent` → cards visibles detrás. Fix: declarar la variable en `:root` con `#131a30`. Una línea CSS, ocho consumidores arreglados. Y el icono `☐` (cuadrado vacío Unicode U+2610) del empty-state, eliminado del template — el title + text + path bastan.

**4 522 / 4 522 tests** passing. Safe upgrade from 2.12.0.

## Phase 63: Quality measurement — plan adherence + golden tasks (v2.12.0)

**v2.12.0** (minor, 2026-05-09) — Two new quality-measurement features land together. The pipeline now scores its *own* runs (per-run **plan adherence**, deterministic 0–100 metric in `summary.md`) and the project as a whole protects itself against version-to-version regression with a small **golden-tasks** suite. Plus a CI policy refinement that frees human-facing documentation from the LOC budget while keeping AI-rule files capped. 8 PRs total (#645–#652) + the release commit #653.

**Plan adherence metric** (`KJC-TSK-0376`, #645/#646/#647): every `kj run` against a known plan computes a deterministic 0–100 score answering *"did the coder follow the plan?"*. Four weighted components — commit attribution (40%), acceptance tests (30%), scope discipline (20%), dependency order (10%) — pure offline calculation, no LLM, no extra cost. Inspired by [deepeval's](https://deepeval.com/guides/guides-ai-agent-evaluation) agent-evaluation guide but kept fully deterministic for reproducibility (golden-task suite friendly). Surfaces in `summary.md` as a new `## Plan adherence` section with score, breakdown table, and the list of HUs that didn't get an attributed commit. Section is omitted when the run wasn't bound to a plan or every component returns null. Spec in [`docs/plan-adherence.md`](https://github.com/manufosela/karajan-code/blob/main/docs/plan-adherence.md).

**Golden tasks regression suite** (`KJC-TSK-0374`, #648/#650/#651/#652): three canonical task fixtures (`todo-rest-api`, `npm-package-cli`, `react-counter-component`) with structural assertions on the produced `summary.md` (commits, audit status, plan adherence threshold) plus filesystem checks (test files, LOC range). The suite runs pre-release (~$5–10 per full pass) and produces `{ok, kjExit, summaryPath, parsed, failures}`. Five assertion families per task, all deterministic. Three orthogonal domains (backend / CLI / frontend). The four sub-PRs split: schema + loader, summary parser + asserter, subprocess runner + filesystem assertions, fixtures + baseline + spec doc. Spec in [`docs/golden-tasks.md`](https://github.com/manufosela/karajan-code/blob/main/docs/golden-tasks.md).

**Shrink-budget refined** (#649): the 200-LOC PR ceiling was forcing artificial truncation of legitimate documentation (CHANGELOG entries, spec files). The gate now exempts human-facing docs (`docs/**`, `CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATION*.md`, `TODO*.md`). AI-rule files (`CLAUDE.md`, `AGENTS.md`, `templates/**/*.md` — role prompts, coder/review rules) **still count** — those go into the agent's context window every run, and unbounded growth there dilutes the signal the AI receives. Same ≤200 LOC discipline as code. **4 522 / 4 522 tests** passing across 381 files.

## Phase 62: Dogfooding pass — UX papercuts + zombi-status fixes + hu-board polish (v2.11.0)

**v2.11.0** (minor, 2026-05-08) — Two-day pass through a 10-level dogfooding plan re-validated every Karajan surface (N0 sanity → N8 demo scripts) and surfaced a long tail of UX papercuts and three latent bugs that only show up on fresh `/tmp/...` repos. 14 PRs (#624–#637).

**Pipeline reliability**: The `SonarStage` no longer loops on remoteless repos (`KJC-TSK-0373` follow-up, #624 + #633) — pre-fix it threw `Missing git remote.origin.url` on every iteration, Brain treated each error as unresolved, and the run finalised via the "approved-by-exhaustion" fallback without ever running Sonar. New shared `canResolveSonarProjectKey` predicate skips the stage cleanly with `gateStatus: SKIPPED`. Locale-aware `commitAll` race tolerance (#633) catches `nothing to commit` / `nada para hacer commit` / `nichts zu committen` / `aucune modification ajoutée au commit` and returns `{committed: false}` cleanly instead of escalating to Solomon. HU-branch fallback (#636): when `init.defaultBranch=master` and the configured `main` doesn't exist, `prepareHuBranch` probes `main → master → HEAD` and uses the first ref that exists — pre-fix every HU silently fell back to the original branch, voiding the per-HU isolation.

**Session status sealing** (`KJC-BUG-0037`, #635): several `runFlow` exit paths returned `{approved: true}` upstream without sealing `session.status`, leaving runs at `running` indefinitely (`kj status` showed "Pipeline RUNNING" forever; the HU Board carried perma-zombies until the 6 h reaper). New boundary guard `sealSessionStatusIfStillRunning` at the runFlow return points maps the result shape to the terminal status (`approved` / `paused` / `cancelled` / `failed`); idempotent + never-throws.

**`writeConfig` strips runtime-only keys** (`KJC-BUG-0036`, #629): the loader synthesised `_deprecated.sonarqubeEnabledKey` and the wizard used `sonarqube.enabled` as a transient hint; `writeConfig` was serialising both, fossilising the deprecation warning into the user's YAML. New `stripRuntimeOnlyKeys` removes both before YAML dump. `addyosmani-catalog` recovers from upstream force-push (`KJC-BUG-0033`, #625): when `git pull --ff-only` fails, fall back to `git fetch --depth 1 origin HEAD` + `git reset --hard FETCH_HEAD`. `kj init` no longer persists the deprecated `sonarqube.enabled` (`KJC-BUG-0034`, #626) — wizard answer survives in memory as a hint for `setupSonarQube` but never reaches disk.

**hu-board features**: Auto-cleanup of ephemeral test projects (`KJC-TSK-0371`, #627) cascade-deletes `tmp_*` / `test_*` / `demo_*` / `kj-test-*` projects inactive >24 h on board start. New `is_test` column on `projects` lets the user override per-project (3-state toggle 🧪 / 📌 / · on each card; `PATCH /api/projects/:id/is-test` endpoint). In-UI help (`KJC-TSK-0372`, #628): new `?` button opens a modal explaining the five views; every nav tab carries a native `title` attribute for the standard hover tooltip.

**UX / display polish**: Sonar `SKIPPED` renders gray, not red, in the result banner (#634) — three colour buckets now (`OK` green / `SKIPPED|PENDING` gray / else red). Result panel + `summary.md` now list **every** commit the run produced via the new `listCommitsBetween(fromSha)` helper plus a new `session.head_at_start` field captured at run start (separate from `base_ref`/`session_start_sha` which can be the empty-tree SHA on single-commit repos) (#632). Help text says `task` is REQUIRED for the 8 commands that need it (#631) — `kj run / code / review / plan generate / triage / researcher / architect / discover` updated. `kj audit` is intentionally untouched (its positional truly is optional).

**Documentation**: New `docs/dogfooding-levels.md` (#630, #637) with the 10-level test plan reconstructed from the JSONL transcript after a context compaction. Each level has a Histórico / Re-validado entry from the 2026-05-07 dogfooding pass. **4 452 / 4 452 tests** passing across 377 files.

## Phase 61.2: Patch — `kj init` wizard expansion (v2.10.2)

**v2.10.2** (patch, 2026-05-07) — `kj init` goes from 9 prompts to a full setup. New `askPerRoleProviders` walks all 10 non-coder/non-reviewer roles (planner, researcher, architect, refactorer, tester, security, solomon, impeccable, perf, hu_reviewer) offering "inherit from coder/reviewer", pick a specific CLI, or disable. New `src/sonar/token-bootstrap.js` logs in to the local Sonar with admin/admin, **rotates the default password** to a fresh secret persisted at `~/.karajan/sonar.admin-password` (mode 0600), revokes any pre-existing `karajan-cli` token and generates a fresh `GLOBAL_ANALYSIS_TOKEN` via `POST /api/user_tokens/generate` — no more walking through the web UI. New prompts for git automation (`auto_commit/push/pr` + `branch_prefix`) and HU Board security (bind host + port). Triggered by user feedback during pre-talk testing on 2026-05-06: "el init es minimalista, falta configurar el resto de roles con qué CLI". PR #616 (KJC-TSK-0367) + #617 (release). +16 new tests; **4 375 / 4 375** passing across 374 files.

## Phase 61.1: Patch — `--json` stdout contamination fix (v2.10.1)

**v2.10.1** (patch, 2026-05-06) — One-line guard in `src/commands/audit.js` that suppresses the `[info]` banner when `--json` is set. Pre-fix, `kj audit --agent-readiness --json | jq` died with a parse error because the logger emitted `Auditing agent-readiness of <path>` to stdout BEFORE the JSON document. Detected in a pre-talk code review (3 Sonnet agents in parallel) before the 2026-05-21 demo. PR #613 (fix) + #614 (release). Plus polish in `docs/demos/` scripts (concrete repo recommendation, realistic timing, `--auto-commit`, `npm install` safety net). New `TODO-post-talk.md` with the 8 P1/P2 findings deferred to post-talk. 4 359 tests passing.

## Phase 61: Agent-readiness — full agent-readability surface + score (v2.10.0)

**v2.10.0** (minor, 2026-05-05) — Karajan becomes the first orchestrator with a full agent-readability surface: an `llms.txt` index at the root, a `SKILL.md` per CLI command under `docs/agents/`, and a static auditor (`kj audit --agent-readiness`) that scores any third-party repo against the same shape. Five PRs (#605–#610) bundling KJC-TSK-0151 / 0228 / 0349 / 0350 / 0351 / 0355. Karajan-on-Karajan agent-readiness score: 100/100. Zero breaking changes; every new flag is opt-in.

**`kj audit --agent-readiness`** (`KJC-TSK-0350`, #609): static, LLM-free score 0–100 across seven checks — llms.txt presence, llms.txt validity (sections + links), robots.txt AI-bot allowlist, per-doc token budget (≤ 32 KB), heading hierarchy, agents/README.md entry point, SKILL.md coverage. Output: per-check ✓/✗, weight-ranked top-fixes list. `--json` for CI; pure data transformation (no network, no LLM, no side effects). Two detector bug fixes brought Karajan-on-Karajan from 80 → 100/100: bash comments inside fenced code blocks no longer count as H1, and `<h1 align="center">` HTML banners are now recognised as valid H1s.

**SKILL.md per CLI subcommand** (`KJC-TSK-0349`, #608): six new `docs/agents/SKILL.kj-{doctor,init,board,review,resume,clean}.md` files closing the gap with `llms.txt` (which advertised them but only three existed). Each follows the established contract (What it does · Inputs · Outputs · Constraints · Side effects · Common failure modes · Example · Related). Architectural test `tests/architecture/agent-readability.test.js` fails CI when a SKILL link in `llms.txt` no longer resolves or a SKILL.md drops a required section. Plus `docs/demos/` (`KJC-TSK-0228`, #610) with three asciinema recording scripts (happy-path, agent-readiness, audit-with-llm), terminal config, pre-recording checklist, and `<asciinema-player>` embedding instructions — scripts as source of truth, .cast files re-recorded per release.

**Webperf quality gate inside the iteration loop** (`KJC-TSK-0151`, #605): `PerfStage` wires `PerfRole` (#603) into `runQualityGateStages` after Impeccable when `pipeline.perf.enabled` is true. PASS verdict → iteration continues; FAIL verdict → `setReviewerFeedback` with concrete blocking metrics + top opportunities, iteration retries; scanner unavailable (lighthouse missing/timeout) → log warn and skip — best-effort, never blocks the pipeline by itself. CLI/MCP parity: `--enable-perf` flag + matching `enablePerf` in `mcp/tools.js`, `mcp/run-kj.js`, sovereignty-guard allowlist, and `applySessionOverrides`.

**HU Board hardening** (`KJC-TSK-0355`, #607): binds `127.0.0.1` by default (was: all interfaces — fine on a personal laptop, problematic on shared coffee-shop WiFi). New `kj board start --bind <host>` for the explicit \"expose on LAN\" case; banner emits a warning + token URL when binding non-loopback. Token auto-generated at `~/.karajan/hu-board/token` (mode 0600, 32 random bytes hex, idempotent). Auth middleware only enforces the token for non-loopback peers — same-machine browser keeps working without `?token=` on every link. Three accepted carriers: `Authorization: Bearer`, `?token=`, `kj_board_token` cookie. `helmet` middleware sets X-Content-Type-Options, X-Frame-Options, conservative CSP, removes `X-Powered-By: Express`. `express-rate-limit` on `/api`: 300 req/min per IP, draft-7 `RateLimit-*` headers.

**a11y/WCAG/ARIA skills auto-route** (`KJC-TSK-0351`, #606): tasks mentioning accessibility / a11y / WCAG / ARIA / screen reader / keyboard navigation auto-pull the `frontend-ui-engineering` skill — until the upstream addyosmani catalog ships a dedicated a11y skill, that's the closest authoritative source for WCAG-aware UI work.

Full suite **4 358 tests across 373 files** — 53 new tests added for this cycle.

## Phase 60: Audit overhaul — stack-aware, two-phase, deterministic-first (v2.9.0)

**v2.9.0** (minor, 2026-05-04) — `kj audit` becomes a stack-aware analysis tool with three deterministic security collectors, dimension auto-activation per project type, persistable reports, token/cost transparency, and an interactive prompt that lets the user inspect cheap findings before paying for the LLM phase. 13 audit PRs (`KJC-TSK-0354` → `KJC-TSK-0366`, #585-#600) plus the 5-PR dead-exports cleanup. Zero breaking changes for MCP/pipeline callers — the legacy `AuditRole.execute()` chains both phases identically.

**Two-phase mode** (`KJC-TSK-0364`, #597): the deterministic collectors (basalCost, Sonar findings, OSV-Scanner, Semgrep, WebPerf, stack detection) run in parallel and print a `## Deterministic Findings` section BEFORE prompting `Continue with LLM analysis? [y/N]`. New `--deterministic-only` flag for zero-token runs (3-second audits with concrete findings), `-y`/`--yes` to auto-confirm, `--json` bypasses the prompt to keep stdout pipeable. CI / non-TTY paths auto-confirm — zero behaviour change for pipelines.

**Three new deterministic security collectors**: SonarQube findings as ground truth in the prompt with rule IDs and line precision (`KJC-TSK-0361`, #588), OSV-Scanner integration covers CVEs across the entire OSV.dev DB (`KJC-TSK-0365`, #598) — broader than `npm audit`, no account, no upload — and Semgrep SAST catches XSS, SQLi, taint flow, hardcoded secrets, language-specific anti-patterns (`KJC-TSK-0366`, #600) — equivalent to `snyk code` but free for OSS. All three are best-effort: missing binary or unreachable host silently skips the section.

**Stack-aware prompt** (`KJC-TSK-0358`, #586): `detectProjectStack` feeds the LLM auditor what kind of project it's looking at — frontend-only, backend-only, fullstack, language, frameworks. Heuristics get filtered: no more N+1 query nags on Astro projects, no more bundle-size nags on Express APIs. New `accessibility` dimension (`KJC-TSK-0359`, #593) auto-activates for frontend / fullstack / unknown stack with WCAG 2.x checks (alt text, labels, ARIA, focus management, contrast hints in CSS tokens). New WebPerf section (`KJC-TSK-0360`, #594) with 10 frontend-perf patterns when no live CWV measurement is available, plus optional Core Web Vitals verdict integration via `config.webperf.lastResult`.

**Persistable reports + token transparency**: `--report-file <path>` (`KJC-TSK-0362`, #592) writes the audit to `.md` (with reproducibility header: timestamp, project, branch, commit, invocation flags) or `.json`. `$KJ_AUDIT_REPORT_DIR` env var as default directory for CI. Every audit ends with a `## LLM Usage` section (`KJC-TSK-0363`, #595) showing provider + model + duration + tokens (in/out/total) + estimated cost in USD. Visible in stdout, JSON output, and persisted reports.

**CLI/MCP parity bug fixed** (`KJC-TSK-0357`, #585): pre-patch the CLI `kj audit` re-implemented `createAgent + buildAuditPrompt + parseAuditOutput` inline, silently dropping the deterministic `basalCost`/`growthDelta` inputs that `AuditRole.execute()` collects when invoked via MCP. Both paths now drive the same `AuditRole` flow — same code path means same prompt content.

**Repo health**: 228 dead exports cleaned in 5 atomic bisect-friendly PRs (`KJC-TSK-0354` A-E, #579-#583). The `kj audit` `findDeadExports` detector itself was overcounting 55x vs knip ground truth — fixed in `KJC-TSK-0356` (#584): now understands `@internal` JSDoc, `await import("path")`, `import * as ns`, re-exports, and strips quoted strings before export-detection regexes. Result: 166 → 4 false positives (99.7% noise reduction).

Full suite **4 305 tests across 367 files** — 106 new tests added for the audit overhaul.

## Phase 59: Audit-driven hardening (v2.8.0)

**v2.8.0** (minor, 2026-04-30) — The 2026-04-30 self-audit (`kj audit`) flagged 13 issues across security, code quality, performance, architecture, and testing. This release closes all of them in 16 PRs (#555 → #570) with 0 user-visible API changes. **Security** (PRs #555 + #562): every `child_process` call in `src/` migrated from template-string `execSync`/`execaCommand` to tokenised `execFileSync`/`execa` arg arrays — no shell metacharacter expansion anywhere, even with constant inputs. Seven sites closed across `verification-gate`, `derive-project-name-from-cwd`, `direct-actions`, `solomon-rules`, `cli`, `config-init`, `init-context`. **Tests** (PR #570): finished the FASE 1 e2e suite — 7 scenarios + `fake-coder.js` / `fake-sonar-server.js` infrastructure cover the 5-bug class from the 2026-04-27 demo regression (zombie-HU, saveSession-missing, Repairer unfixable, zombi-status, audit smoke). Each test < 90s; full e2e in 6s, no real LLM/network. **File splits** (PRs #560/#567/#568/#569): `cli.js` 699→113 LOC (+ 6 register modules), `commands/plan.js` 549→14 LOC shim (+ one file per sub-command), `iteration-loop.js` 513→311 LOC (+ 5 phase files), `pre-loop.js` 626→435 LOC. Every big driver under the 600-LOC ceiling. **ESLint hardening** (PRs #556/#557/#559/#564): baseline extended to `tests/` with the same bug-killer trio (`no-undef`, `import-x/no-unresolved`, `import-x/named`); `globalThis.__KJ_*` banned outside `src/config/test-harness.js`; `no-console: error` outside CLI/display paths; 57 warnings closed in `src/`, then `no-unused-vars` / `no-useless-assignment` / `no-useless-escape` / `preserve-caught-error` ratcheted warn→error. **Architecture & perf** (PRs #558/#565/#566): Node subpath imports map (`#utils/*`, `#session/*`, `#hu/*`, `#skills/*`) eliminates `../../../` chains; `adr-loader.js` and `garbage-collector.js` parallelised via `Promise.all`; per-directory coverage thresholds in `vitest.config.js`. **BREAKING (runtime floor)**: `engines.node` 18→20.10.0 (Node 18 LTS hit EOL on 2025-04-30; CI matrix dropped Node 18). 4 199 tests across 357 files.

## Phase 58: Contract fixes — Sonar intrinsic + no fake API keys (v2.7.4)

**v2.7.4** (patch, 2026-04-24) — Three contract-level fixes revealed while the user dogfooded v2.7.3. (1) **Sonar is now intrinsic to Karajan for code tasks**, like TDD. The `sonarqube.enabled` config field and the `--no-sonar` CLI flag are IGNORED (deprecation warning at run start) — a code task without a quality gate is not a job Karajan can call complete. Sonar runs for `sw`/`refactor`/`add-tests` by policy and skips for `audit`/`doc`/`infra`/`analysis`/`no-code`. Solomon may still skip an iteration via runtime rule alerts (legitimate override based on evidence). (2) **Preflight no longer demands API keys Karajan doesn't use**. The v2.7.3 preflight FAILed with `ANTHROPIC_API_KEY not set` — blocking every Claude Code MCP run where the parent uses OAuth — even though Karajan never calls provider APIs directly (zero SDK imports, all agents spawn CLIs as subprocesses). Replaced with a real CLI availability check (`claude`/`codex`/`gemini` on PATH). (3) **Orchestrator no longer crashes** with `Cannot read properties of undefined (reading 'push')` on the Solomon init-error path — `addCheckpoint` now defensively initialises `session.checkpoints = []`. Two new architectural invariants (`tests/architecture/no-provider-apis.test.js` and `tests/architecture/sonar-intrinsic.test.js`) make these contracts enforceable in CI. New `docs/TESTS.md` test-suite guide (~280 lines) covers directory map, pipeline-coverage diagram, per-file explanation and contribution checklist.

## Phase 57: addyosmani/agent-skills as first-source process catalog (v2.7.0 / v2.7.1 / v2.7.2 / v2.7.3)

**v2.7.3** (patch, 2026-04-23) — Three dogfooding fixes driven by a live test run. (1) Every task-taking command — CLI `kj run/code/review/plan/audit/discover/triage/researcher/architect` and the matching MCP tools — now accepts a task from a `.md` file via `--task-file <path>` (CLI) or `taskFile` (MCP). Positional `task` still wins when both are given. (2) CLI invocations finally write `.kj/run.log` like MCP does via a new `withCliRunLog()` helper, so `kj-tail` is symmetric regardless of whether Claude Code launches `kj` via Bash or via the MCP tool. (3) Node 18 LTS is supported for real now: preflight used to require Node 20 with a misleading message, but the four features it cited (`structuredClone`, `findLast`, `AbortSignal.timeout`, stable `fetch`) are all 18+; `MIN_NODE_MAJOR` lowered to 18, CI lint matrix gains `18.x`. `kj-tail` v1.38.0 additionally waits for the log file to appear instead of exiting when it is missing, so users can no longer miss early lines by racing the command.

**v2.7.2** (patch, 2026-04-23) — Skills observability: `summary.md` now includes a "Skills Used" section listing the addyosmani action (`cloned`/`pulled`/`fresh`/`unavailable`) and the role/task-resolved slugs injected into role prompts, the OpenSkills actually installed, and would-have-used recommendations when the CLI is missing. `kj-tail` v1.37.0 adds a 🎯 filter for `[skills:*]` events — magenta on success, yellow on graceful-degradation paths. Closes the loop started in v2.7.0: skill decisions are now visible in the live tail, in `.kj/run.log`, and in the persistent `summary.md`.

**v2.7.1** (patch, 2026-04-23) — Restores SEA platform binary publishing (`kj-linux-x64`, `kj-darwin-arm64`, `kj-win-x64.exe` + SHA256 checksums) on GitHub Releases. The `release-binaries.yml` workflow had been silently failing on every tag push since **v2.4.1** (5 consecutive releases shipped with empty assets). Root cause: `scripts/build-sea.mjs` does `await import("esbuild")` — an ESM dynamic import that resolves from local `node_modules` — while the workflow installed esbuild with `npm install -g`. Fix: `esbuild` (`^0.28.0`) and `postject` (`^1.0.0-alpha.6`) are now `devDependencies`, so a single `npm ci` pulls them into `node_modules` where the dynamic import resolves. v2.7.1 is byte-equivalent to v2.7.0 at runtime; the only difference is the release assets.

**v2.7.0** (2026-04-22) — Karajan now consults Addy Osmani's [`agent-skills`](https://github.com/addyosmani/agent-skills) curated process catalog **before** OpenSkills when resolving which skills to inject into role prompts. The two providers cover orthogonal axes: addyosmani brings lifecycle/process workflows (TDD, code-review, security-and-hardening, performance-optimization, git-workflow-and-versioning, CI/CD, debugging, docs, spec-driven, planning...) mapped per Karajan role, while OpenSkills keeps providing stack-specific skills (astro, react, prisma, vitest-patterns...). On first use, the catalog is shallow-cloned into `~/.karajan/agent-skills/`; subsequent runs refresh via `git pull` after `skills.addyosmani.refreshDays` (default 7 days). When git is absent or the network is unreachable, the step degrades silently and the pipeline continues unblocked. The role → slug map lives in `src/skills/addyosmani-role-map.js` (tester → `test-driven-development` + `browser-testing-with-devtools`, reviewer → `code-review-and-quality` + `code-simplification`, security → `security-and-hardening`, architect → `spec-driven-development` + `api-and-interface-design` + `planning-and-task-breakdown`, and so on). Task-text triggers add slugs on top — a task mentioning "performance" or "Core Web Vitals" pulls `performance-optimization`. New config surface: `skills.sources` (default `["addyosmani", "openskills", "local"]`) and `skills.addyosmani.{enabled,refreshDays,repoUrl}` validated by the Valibot schema. New CLI: `kj skills sync-addyosmani` forces a pull, `kj skills list-addyosmani` enumerates cached slugs with descriptions. 35 new test cases land in `tests/skills/addyosmani-*.test.js` covering frontmatter parsing, clone/pull lifecycle, TTL, path-traversal guards and graceful degradation. Test suite now at 3 672 tests across 285 files.

## Phase 56: Modular Orchestrator + Infrastructure DI + Valibot (v2.6.0 / v2.6.1)

**v2.6.1** (patch, 2026-04-20) — Fixes the HU Board sync so sessions without a matching auto-batch no longer disappear: `syncSessionFile` now falls back `auto-<sessionId>` → `data.project_id` → `"default"` (Orphan sessions bucket) and always creates the project row. Also isolates the test suite from the developer's real `~/.kj/plans/` via a new `KJ_PLANS_DIR` knob. Restores two regressed tests.

**v2.6.0** — The biggest internal cleanup since Brain. `src/orchestrator.js` shrinks from a 2 084-line god-module to a 22-line public barrel over `src/orchestrator/flow-runner.js`; a new `StageExecutor` contract (`canRun` / `execute` / `onFailure`) with `StageRegistry` and `runStage()` makes future stages self-describing so the core no longer branches on `pipelineFlags` for every feature. Infrastructure DI lands under `src/infrastructure/`: `FileSystemService`, `CommandRunner`, and an `Environment` bundle let every agent (Claude, Codex, Gemini, Aider, OpenCode) route shell calls through a runner the tests can mock with `MockCommandRunner` instead of spawning real subprocesses. Config is now validated on load with Valibot — `review_mode` typos, `max_iterations: 0`, out-of-range `hu_board.port`, invalid `budget.warn_threshold_pct`, and negative `max_budget_usd` fail fast with readable messages; falsy CLI overrides (`--no-rebase`, `--reviewer-retries 0`) finally work as advertised (co-authored with Jorge del Casar from the revived PR #379). The session journal gains three new artifacts (`decisions.md`, `iterations.md`, `summary.md`) plus a directory-grouped `tree.txt`. Budget display now projects "With KJ vs Without KJ" savings from RTK + Brain compression. Test suite lands at 3 638 tests across 283 files, with 21 opt-in subsystem files labelled `[opt-in: <feature>]` and a new `tests/support/opt-in.js` helper driving `KJ_SKIP_OPTIN_*` env kill switches. HU Board auto-start gate is simplified to `hu_board.auto_start` alone and displays the URL in a prominent cyan banner at pipeline init. Central JSDoc typedef registry lands under `src/types/` with an opt-in `npm run typecheck`.

## Phase 55: Mini Planning Game (v2.5.0)

**v2.5.0** — First-class two-phase workflow: plan first, then execute. `kj plan "task"` generates a v2 plan with HUs (globally unique IDs, acceptance tests, task_type classification). `kj plan list/show/validate/delete/ready/add-hu/remove-hu` give full CRUD over stored plans under `~/.kj/plans/`. `kj run --plan <planId>` executes the plan's HUs via the sub-pipeline with acceptance tests, updating the plan file in real time (status: running → done/failed). HU Board syncs from `~/.kj/plans/` — plans show up as projects with HU status. v2 schema with lazy v1→v2 migration, cycle detection in the dependency graph. Bug fixes in the same release: Sonar quality gate finally runs for `sw` HUs (acceptance_tests bypassed the standard pipeline), HU Board shows rich data (title, scope, acceptance criteria), vitest updated to 0 npm vulnerabilities.

## Phase 54: Executable Acceptance Tests (v2.4.0)

**v2.4.0** — First version where the full demo completes successfully end-to-end with auto-HU decomposition. Each HU now carries `acceptance_tests`: an array of shell commands that Brain executes after every coder iteration. All pass → HU approved. Any fail → Brain reads the exact error output and sends a concrete diagnostic to the coder ("install @vitest/coverage-v8", not "Coverage: not measured"). No reviewer. No generic tester. Concrete pass/fail. When `acceptance_tests` are defined, Brain replaces the standard reviewer/tester pipeline with a custom loop (coder → acceptance_tests → diagnose → retry). Security audit also included: `execSync` → `execFileSync` for git add, exact token allowlist matching, credentials file `0o600` permissions, token masking in MCP responses, vitest updated to 0 npm vulnerabilities. Demo result: 6 HUs, 280 tests, 97% coverage, 0 vulnerabilities.

## Phase 53: Complete Brain audit (v2.3.0)

**v2.3.0** — Exhaustive audit of the orchestrator found and fixed 21 v1 legacy violations where Solomon was invoked directly (bypassing Brain), `session.task` leaked into per-HU context, or feedback mutations skipped Brain's queue. Every stage now gates Solomon through Brain when enabled. Per-HU reviewer evaluates the HU scope, not the full spec. HU Board gains `/api/sync` endpoint for live batch detection. Model registry updated with 2026 families (Jorge del Casar #412).

## Phase 52: HU Board UX + Minimal HU scope (v2.2.0 - v2.2.1)

**v2.2.0** — HU Board UX overhaul: human-readable project names derived from task prompt, DELETE endpoints + per-card delete button, port fallback (4000→4009), auto-start on auto-HU generation with highlighted cyan URL banner. Also excludes `.kj/` worktrees from vitest.

**v2.2.1** — Critical fix: auto-generated HUs were too large because the setup HU embedded the full task description. Now setup HU says "DO NOT implement any business logic — ONLY project scaffolding" and task HUs target "<200 lines changed (like an atomic PR)". Legacy batch names derived from embedded "Part of:" text. Extended stopwords. Delete button moved to per-card.

## Phase 51: Auto-HU Decomposition (v2.1.0)

**v2.1.0** — Closes the fundamental architectural gap where complex tasks ran as one giant pipeline instead of splitting into atomic stories. From v2.1, when triage recommends decomposition, Karajan auto-generates a certified HU batch and runs each HU as an independent sub-pipeline with its own git branch, commit, and optional PR.

**Added:**
- **HU auto-generator** (`src/hu/auto-generator.js`) — converts triage subtasks into a certified HU batch with automatic setup HU when the project is new or has stack hints. Each HU classified into `task_type` (infra/sw/add-tests/doc/refactor/nocode) so downstream policy gates apply correctly per HU.
- **Triage → auto-gen → sub-pipeline wiring**: after triage + researcher + architect + planner, if triage flagged `shouldDecompose` and no manual `--hu-file` was passed, the batch is persisted to `.karajan/hu/auto-<sid>/batch.json` and injected as `stageResults.huReviewer`. The existing `needsSubPipeline` / `runHuSubPipeline` infrastructure picks it up.
- **Per-HU max_iterations** (`config.hu_max_iterations`, default 3) — each HU gets a focused iteration budget and a fresh Brain state (feedback queue, verification tracker, extension count reset to 0) so issues from one HU never bleed into the next.
- **Per-HU git automation** (`src/git/hu-automation.js`) — each HU gets its own branch (`feat/HU-<id>-<slug>`) chained from its parent HU's branch. On approval: commits atomically with `feat(HU-<id>): <title>`, optionally pushes and opens a PR (gated by existing `git.auto_commit`/`auto_push`/`auto_pr` flags).

**Why:** v2.0.x had a known gap — complex tasks triggered decomposition in triage but the pipeline ignored it and ran one giant coder invocation that produced 50-file blobs reviewers and testers couldn't validate properly. v2.1 closes this: big tasks become atomic branches/PRs, each with focused iteration budget, fresh Brain state, and isolated failure semantics. Reviewer, tester, and security can finally do their jobs.

## Phase 50.2: Brain coverage + UX overhaul (v2.0.2)

**v2.0.2** — Extends Brain's coverage across all stages and makes `kj run` actually tell you what it's doing.

**Added:**
- **Brain compression + feedback queue across all stages**: researcher, architect, planner outputs are compressed for metrics; tester and security failures enter the typed feedback queue with enrichment for the next coder iteration.
- **Brain owns max_iterations decision**: at max_iterations Brain inspects its feedback queue — security entries → pause for human (cannot finalize with unresolved security issues), correctness/tests → extend iterations, empty queue → finalize, style-only → consult Solomon as advisor. Solomon is never invoked directly from max_iterations anymore.
- **Agent action lines in quiet mode**: `kj run` now interprets Claude's stream-json tool_use blocks into concise action lines (`Read packages/server/index.js`, `Bash $ npm install express`) so users see what the coder is doing without verbose mode.
- **Heartbeat visible in quiet mode**: `agent:heartbeat` events (every 30s) are no longer suppressed — `kj run` shows `⏳ claude working — 45s elapsed` instead of looking hung during long agent calls.
- **ASCII banner printed on `kj run`** regardless of TTY detection.

**Changed:**
- Rule alerts renamed from `solomon:alert` to `brain:rules-alert` (display: "⚠️ Rules alert" instead of "⚖️ Solomon alert"). The rules engine emits telemetry; it is not an invocation of Solomon.
- All stage `onOutput` handlers route through the unified `emitAgentOutput` helper: `kind=tool` → `agent:action` (visible in quiet mode), others → `agent:output` (verbose only).

## Phase 50.1: Brain wired into the pipeline (v2.0.1)

**v2.0.1** — Patch release that actually turns Brain on. v2.0.0 shipped the Brain modules but nothing imported them, so the pipeline still ran v1 logic (Solomon-as-boss). This release wires Brain into the real execution path.

**Fixed:**
- `brainCtx` is now created at session init and threaded through coder and reviewer stages
- **Coder stage**: uses Brain's enriched feedback prompt from the typed queue; calls `verifyCoderRan` after each run; pipeline stalls after N consecutive 0-change iterations
- **Reviewer stage**: on correctness/tests/security rejections Brain bypasses Solomon and pushes typed issues to the feedback queue for the next iteration. Solomon is only consulted on style-only dilemmas.
- **Brain owns human escalation** — `solomon-rules` no longer prompts the user directly. Critical rule alerts (stale iterations, new deps) flow through Brain → Solomon AI judge → human (only if neither can resolve the dilemma).
- **Brain actively consults Solomon** on detected dilemmas and applies Solomon's decision (approve / continue / pause).
- **Stale detection** — reviewer checkpoints now record a feedback signature, coder checkpoints record `filesChanged`. Previously both were empty/zero, making solomon-rules falsely detect "stale" after 3 iterations with different bugs.
- **HU Board auto-start crash** on nvm/macOS (reported by Jorge del Casar). `spawn('node', ...)` failed with ENOENT because the detached subprocess didn't inherit node's PATH. Fixed by using `process.execPath` and adding an error handler so the pipeline never crashes from HU Board startup failures.

**Changed:**
- **Brain enabled by default** (`brain.enabled: true`). v2 is Brain architecture; users who explicitly don't want Brain can set `brain.enabled: false`, but the canonical v2 experience is Brain-on.

## Phase 50: Karajan Brain + Solomon Judge (v2.0.0)

**v2.0.0** — Major architectural redesign. Introduces **Karajan Brain** as the central AI orchestrator and refines **Solomon** from pipeline boss to AI judge consulted only on genuine dilemmas.

**Key additions:**
- `KarajanBrainRole` — central AI-powered orchestrator that routes all role-to-role communication
- `brain-coordinator.js` — integrates 5 Brain modules (queue, enrichment, verification, actions, compression)
- `feedback-queue.js` — typed message queue replacing the flat `last_reviewer_feedback` string
- `feedback-enrichment.js` — transforms vague feedback into actionable plans with file hints and severity
- `verification-gate.js` — detects 0-change coder iterations via `git diff --numstat` + untracked files
- `direct-actions.js` — allow-listed commands Brain can execute (npm install, gitignore updates, create_file, git_add)
- `role-output-compressor.js` — per-role compression strategies yielding 40-70% token savings between roles
- Smart init — assigns AI agents to roles by capability (claude=5, codex=4, gemini=3, aider/opencode=2), diversifies reviewer from coder
- Solomon refined to 4 advisory skills: security-vs-deadline, conflicting-quality-gates, stalled-loop-analysis, risk-evaluation
- Deterministic security bypass: when reviewer has security-category issues, Brain skips Solomon and sends directly to coder

**Architecture:**
```
triage → Brain (routes) → researcher/architect/planner → Brain (compresses) → coder
                                                                               ↓
                                                    Brain (verifies changes) ←─┘
                                                                               ↓
                                            reviewer → Brain (enriches feedback)
                                                                               ↓
                                   security issue? → coder (Solomon bypassed) ─┤
                                   dilemma? → Solomon (opinion) → Brain decides┤
                                                                               ↓
                                    tester + security + impeccable (blocking)
                                                                               ↓
                                                                       audit → PR
```

**Removed:**
- v1 string-based `last_reviewer_feedback` flow
- Solomon as pipeline boss / blocking arbiter
- Per-role boilerplate (~200 LOC × 10 roles via `AgentRole` base class)
- Dead config paths and unused proxy layer

**Why:** v1 accumulated ad-hoc communication paths between roles (string feedback, solomon-as-boss, mixed concerns). v2 centralizes orchestration intelligence in Brain, keeps Solomon as a focused AI judge for true dilemmas, and yields 40-70% token savings through per-role compression. Full upgrade guide in [MIGRATION-v2.md](https://github.com/manufosela/karajan-code/blob/main/MIGRATION-v2.md).

## Phase 46: Domain Knowledge System (v1.58.0)

**v1.58.0** — New `domain-curator` role (16th role). Discovers, proposes and synthesizes business-domain knowledge so all downstream roles work with real-world context — not just technical frameworks.

**Key additions:**
- Domain storage: `~/.karajan/domains/` (user/company bank, reusable across projects) + `.karajan/domains/` (project-specific overrides). DOMAIN.md files with YAML frontmatter and markdown sections
- Domain registry: local JSON index at `~/.karajan/domain-registry.json` with search by tags/hints
- Domain synthesizer: filters relevant sections by keyword overlap, compacts to token budget
- Domain Curator role: deterministic (no LLM cost) — loads domains, proposes selection to user (if interactive), synthesizes context
- Enhanced `buildAskQuestion`: detects `server.getClientCapabilities()?.elicitation` to adapt to host MCP capabilities. Supports structured question types (multi-select, select, confirm) with free-text response parser
- Triage `domainHints`: triage detects business-domain keywords and passes them to the Curator
- Skill-loader type discrimination: `SKILL.md` files with `type: domain` frontmatter are loaded by the Curator (injected into all roles) vs `type: technical` (coder-only)
- `domainContext` injected into all downstream role prompts (Researcher, Architect, Planner, Coder, Reviewer, HU-Reviewer)
- 102 new tests

**v1.58.1** — CLI welcome screen on bare `kj` invocation: shows version, configured agents, and quick start commands.

**Architecture addition:**
```
triage → domainHints: ["dental", "clinical"]
       → domain-curator → loadDomains + registry.search → askQuestion (if interactive) → synthesizeDomainContext
       → domainContext injected into researcher, architect, planner, coder, reviewer, hu-reviewer prompts
```

**Why:** AI agents writing code for a specific industry (dental, logistics, finance) make better decisions when they understand the business domain — correct naming, real edge cases, proper validation rules. The Domain Curator adds this context at zero LLM cost (deterministic loader + synthesizer), reusable across projects.

## Phase 49: SEA Binaries, Model Resolution, SonarQube Robustness (v1.57.1 - v1.57.2)

**v1.57.1** — SEA (Single Executable Application) binary build: standalone binary via `node scripts/build-sea.mjs` that requires no Node.js installation. GitHub Actions release workflow builds binaries for linux-x64, darwin-arm64, and win-x64 with SHA256 checksums on every tag. YAML config loader now tolerates duplicated keys in user config files.

**v1.57.2** — Model/provider resolution: when the model field uses a prefixed format like `gemini/pro`, KJ infers the provider from the prefix and strips it (model becomes `pro`). Incompatible explicit models (e.g., a gemini model on a claude provider) are dropped gracefully. SonarQube auto-start wait: after `docker compose up`, waits up to 60 seconds (polling every 5s) for SonarQube to become ready, fixing false "auto-start failed" errors on cold boot. Subprocess stdin prevention: all subprocesses run with `stdin: "ignore"`, preventing indefinite hangs when SonarQube, agents, or npm prompt for input. `kj init` gitignore entries: auto-appends `.kj/`, `.agent/`, `.scannerwork/` to the project `.gitignore` if missing. Global repo protection scripts: `protect-all-repos.sh` (branch protection), `install-guard-all-repos.sh` (AI attribution guard), `ai-attribution-guard.yml` (standalone workflow).

## Phase 48: Telemetry & MCP Graceful Restart (v1.57.0)

**v1.57.0** — Opt-out telemetry: anonymous usage statistics (version, OS, command, pipeline duration, success rate) to help improve Karajan. No task descriptions, code, or personal data collected. Opt out with `telemetry: false` in config or `KJ_TELEMETRY=false` env var. MCP graceful restart: after npm update, the MCP server writes a restart marker and exits cleanly. The new instance detects the marker and starts with fresh code, replacing the abrupt `Transport closed` behavior. `kj_resume` now respects the session's saved config snapshot, preserving flags like `--no-sonar` that were set during the original run.

## Phase 47: Status Dashboard & Auto-Detect Stack (v1.56.0)

**v1.56.0** — `kj status` terminal dashboard showing HU states, current pipeline stage, timing, and progress. MCP returns structured JSON for programmatic access. `kj init` now auto-detects the project stack by scanning package.json, go.mod, Cargo.toml, requirements.txt, and similar files. Detected frameworks auto-configure the pipeline (impeccable enabled for frontend projects, test framework pre-selected, SonarQube language settings applied). HU Board now supports optional Bearer token authentication via `HU_BOARD_TOKEN` environment variable.

## Phase 46: kj undo & Doc Links (v1.55.0)

**v1.55.0** — New `kj undo` command (24th MCP tool) reverts the last pipeline run with a soft git reset, or `--hard` to discard all changes. All error messages now include a direct URL to the relevant documentation page, making troubleshooting faster without manual doc searches.

## Phase 45: Design Refactoring Mode (v1.54.0)

**v1.54.0** — `--design` flag: impeccable role switches from audit-only to refactoring mode. Coder applies design changes (hierarchy, spacing, responsive, a11y, animations, theming).

## Phase 44: Plan-Run Connection & MCP Response Compressor (v1.53.0 - v1.53.1)

**v1.53.0** — Plan to Run connection: `kj_plan` now runs researcher + architect before planner, persisting the full result. `kj_run --plan` loads the persisted plan context and skips pre-loop stages (researcher, architect, planner), going straight into the coder loop with full architectural context already resolved.

**v1.53.1** — MCP response compressor: strips verbose fields from MCP tool responses, truncates large arrays, and outputs compact JSON. Reduces token consumption when MCP hosts relay pipeline results back to the conversation context.

## Phase 43: No-Code Pipeline Mode (v1.52.0)

**v1.52.0** — No-code pipeline mode: triage detects non-code tasks (SQL analysis, CSV transforms, data reports) and disables TDD/SonarQube/reviewer stages automatically. Three built-in no-code skills: `sql-analysis`, `csv-transform`, `data-report`. Tasks that don't produce code changes skip the entire quality gate loop.

## Phase 42: RTK Real Integration (v1.51.0)

**v1.51.0** — RTK real integration: auto-install during kj init, enforce wrapping in internal Bash commands, measure and report token savings per session. Audit/analysis tasks skip coder/reviewer and route directly to security+audit roles. Homebrew tap (`brew tap manufosela/tap && brew install karajan-code`) added as an alternative installation method for macOS users.

## Phase 41: God-Module Split & Critical Unit Tests (v1.50.0)

**v1.50.0** — 71 new unit tests covering 3 critical modules. Split 3 god-modules into 12 focused sub-modules for better maintainability and testability. 2473 tests across ~190 files.

**v1.50.1** — Pipeline messages respect configured language (EN/ES message catalog). Checkpoint UI restructured with numbered options instead of ambiguous Accept/Decline buttons.

## Phase 40: Async I/O & Centralized SonarQube (v1.49.0)

**v1.49.0** — Async I/O: all file and network operations converted to non-blocking async patterns. Centralized SonarQube configuration: single source of truth for Sonar settings across CLI, MCP, and pipeline. 61 catch blocks documented and audited for proper error handling.

## Phase 39: PG Card Lifecycle & HU Board Sync (v1.48.0)

**v1.48.0** — PG card lifecycle tracking: pipeline events now update Planning Game card status in real time throughout the full lifecycle (created, in-progress, blocked, to-validate, done). HU Board real-time status sync: board UI reflects card state changes as they happen, eliminating manual refresh.

## Phase 38: Parallel HU Execution & Standalone Binaries (v1.46.0)

**v1.46.0** — Parallel HU execution via git worktrees (independent HUs run concurrently). SEA binary build scripts + GitHub Actions release workflow (standalone binaries without Node.js). Python wrapper for pip install. Docker image + shell installer.

## Phase 37: WebPerf Quality Gate (v1.45.0)

**v1.45.0** — WebPerf Quality Gate: Core Web Vitals (LCP, CLS, INP) as pipeline gate via Chrome DevTools MCP + Joan Leon's WebPerf Snippets skills. Configurable thresholds.

## Phase 36: i18n (v1.44.0)

**v1.44.0** — i18n: kj init detects OS locale, asks for pipeline and HU language. Agents respond in the configured language. Supports English and Spanish.

## Phase 35: Docker & Shell Installer (v1.43.0)

**v1.43.0** — Docker image (Alpine + Node 20) for containerized execution. Shell installer (`curl | sh`) for one-line installation without npm.

## Phase 34: Lean Audit & Lazy HU Planning (v1.42.0)

**v1.42.0** — Lean audit measures basal cost: dead code detection, unused dependency analysis, and complexity growth tracking. Lazy HU planning: refine one HU at a time with context from completed ones, reducing upfront planning overhead.

## Phase 33: OpenSkills Integration (v1.41.0)

**v1.41.0** — OpenSkills integration: new `kj_skills` MCP tool (23rd) for managing domain-specific skills. Skill injection in coder, reviewer, and architect prompts. Triage auto-detects and installs domain skills relevant to the current task.

## Phase 32: Pipeline Sovereignty & Observations (v1.40.0)

**v1.40.0** — Pipeline sovereignty: MCP input guard strips host AI overrides, preventing external agents from silently changing pipeline configuration. New `kj_suggest` MCP tool (22nd) allows observations to Solomon without interrupting the pipeline. E2E install tests across ubuntu, macOS, and Windows. CLI update notification at startup.

## Phase 31: Integrated HU Manager (v1.38.0)

**v1.38.0** — Integrated HU Manager: triage auto-activates hu-reviewer for medium/complex tasks, AI-driven decomposition into 2-5 formal HUs with dependencies, sub-pipeline execution per HU with state tracking (pending→coding→reviewing→done/failed/blocked), PG adapter feeds card data to hu-reviewer, history records for all pipeline runs. 49 new tests.

### v1.38.1: kj_hu Tool, Multi-Language TDD, Solomon Readable Messages

**v1.38.1** — New `kj_hu` MCP tool for managing user stories (create, update, list, get) directly from the HU Board. Multi-language TDD support: 12 languages beyond JS/TS (Java, Python, Go, Rust, C#, Ruby, PHP, Swift, Dart, Kotlin). Solomon readable messages for clearer pipeline decisions. Sonar token fix for secure credential handling. MCP sovereignty: tools reject external override attempts, preserving human-confirmed configuration. 2142 tests across 170 files.

### v1.38.2: Reviewer Visibility & Credential Hardening

**v1.38.2** — Reviewer now sees new files created by coder (git add -A before diff). All 15 credential patterns block the pipeline (secrets never pass). Coder template mandates .env usage for all keys.

**v1.39.0** — CLI update notification: non-blocking npm version check at startup, cached 24h.

## Phase 30: Injection Guard (v1.37.0)

**v1.37.0** — Injection Guard: prompt injection scanner for AI-reviewed diffs and PRs. Scans diffs before passing them to AI reviewers, detecting directive overrides ("ignore previous instructions"), invisible Unicode characters (zero-width spaces, bidi overrides), and oversized comment block payloads. Runs as a deterministic guard in the pipeline (before reviewer stage) and as a standalone GitHub Action on every PR.

## Phase 29: Bootstrap Gate (v1.35.0)

**v1.35.0** — Mandatory bootstrap gate for all KJ tools: validates prerequisites (git repo, remote, config, agents, SonarQube) before any tool runs. Hard-fail with actionable fix instructions, never silently degrades. Removed default admin/admin SonarQube credentials (security fix).

### v1.36.0: Real Usage Metrics & kj-tail

**v1.36.0** — Extract real usage metrics from Claude and Codex CLIs. `kj doctor` validates agent config files (JSON, TOML, YAML). Resilient model fallback and Solomon conflict context. Stage name in agent heartbeat/stall messages.

**v1.36.1** — `kj-tail` as installable CLI command with `--help` and filtering. Three ways to use Karajan documented: CLI, MCP, kj-tail. Full pipeline example with booking API output. Executor info in all pipeline stage events (provider, AI/skill/local).

## Phase 28: HU Board Dashboard (v1.34.0)

**v1.34.0** — HU Board: full-stack web dashboard for visualizing HU (user story) data and pipeline sessions across all projects. Kanban board with drag-and-drop, session timeline with quality score overlays, multi-project filtering. Docker-ready deployment with auto-sync from local `.karajan/` session and HU files. Standalone app that reads Karajan's local data and presents it in a browser-based UI.

### v1.34.1: Reliability Fixes

**v1.34.1** — 5 reliability fixes: auto-preflight for seamless pipeline start, robust JSON parser that handles malformed agent output, model compatibility layer for cross-provider model names, budget estimation with fallback for unknown models, and coder no-placeholder prompt that prevents agents from leaving TODO stubs.

### v1.34.2: HU Board CLI & MCP Integration

**v1.34.2** — HU Board integrated into CLI (`kj board start/stop/status/open`), MCP (`kj_board` tool for start/stop/status), init wizard (enable HU Board during `kj init`), auto-start option (board starts automatically on `kj run`), and skills mode support.

### v1.34.3: Cognitive Complexity Refactor

**v1.34.3** — Reduced cognitive complexity across 6 core files. Zero skipped tests, 44 new board backend tests.

### v1.34.4: Cross-Platform Install

**v1.34.4** — OS-aware install commands: macOS uses brew, Linux uses curl/apt/pipx. Agent install instructions adapt to the user's platform.

## Phase 27: Product Context & Multi-Format AC (v1.33.0)

**v1.33.0** — Product context via `.karajan/context.md`: projects can define domain knowledge, glossary, and constraints that are injected into every pipeline role prompt. Multi-format acceptance criteria: supports Gherkin (Given/When/Then), Checklist, Pre/Post-conditions, and Invariants — auto-detected from task input. RTK auto-integration: when RTK is installed, Karajan auto-configures token optimization without manual setup. Architect containerization: architect role outputs are now isolated in structured containers for cleaner planner handoff.

## Phase 26: Mandatory Audit Post-Approval (v1.32.0)

**v1.32.0** — Mandatory audit post-approval: final quality gate runs after reviewer+tester+security pass. Checks generated code for critical/high issues — if found, loops coder back to fix. If clean, pipeline is CERTIFIED. Also: quiet mode by default (raw agent output suppressed), Solomon autonomous decisions (checkpoints auto-continue, tester/security advisory), CLI inline readline prompt, budget N/A when provider doesn't report usage.

## Phase 25: HU Reviewer (v1.30.0)

**v1.30.0** — New mandatory pipeline stage for user story certification. Scores 6 quality dimensions (0-10 each, threshold 40/60), detects 7 antipatterns, rewrites weak HUs, pauses for FDE context when needed. Supports dependency graphs with topological execution ordering. Local file storage with future adapter pattern.

## Phase 24: Codebase Quality Refactor (v1.29.0)

**v1.29.0** — Codebase quality refactor driven by self-audit findings: PipelineContext object replaces 15+ parameter destructuring, MCP handlers reduced by 151 lines via shared `runDirectRole()`, Planning Game logic extracted into event-driven adapter, 105 new agent unit tests, npm audit vulnerabilities patched.

## Phase 23: Codebase Health Audit (v1.28.0)

**Phase 23: Codebase Health Audit (v1.28.0)** — New `kj audit` command for read-only codebase analysis. Analyzes 5 dimensions: security, code quality (SOLID/DRY/KISS/YAGNI), performance, architecture, and testing. Available as CLI, MCP tool (`kj_audit`), and skill (`/kj-audit`). Generates structured reports with A-F scores per dimension and prioritized recommendations.

## Phase 22: RTK Integration (v1.27.0)

**v1.27.0** — RTK integration: `kj doctor` detects RTK for 60-90% token savings, `kj init` recommends installation, README and docs updated with RTK as recommended companion tool.

**v1.27.1** — Fix MCP project directory resolution: all MCP tools now accept explicit `projectDir` parameter. Resolution order: explicit param > MCP roots > cwd validation > error with instructions (no silent fallback).

## Phase 21: Autonomous Orchestrator (v1.25.0)

**What changed:** Solomon becomes the Pipeline Boss that evaluates every reviewer rejection with smart iteration logic. The pipeline auto-detects TDD and auto-manages SonarQube, reducing configuration to near-zero for standard projects.

**Key additions:**
- **Solomon as Pipeline Boss**: evaluates every reviewer rejection, classifies issues as critical vs. style-only, can override style-only blocks. Smart iteration control decides whether to retry or proceed based on issue classification
- **Auto-detect TDD**: pipeline detects the project's test framework (Vitest, Jest, Mocha, etc.) and enables TDD methodology automatically — no `--methodology` flag needed
- **SonarQube auto-manage**: auto-starts Docker container, auto-generates `sonar-project.properties` if missing, treats coverage-only results as advisory (non-blocking)
- **Skip sonar/TDD for infra/doc tasks**: policy-resolver now skips SonarQube and TDD for infrastructure and documentation tasks automatically, reducing false positives
- 1605 tests across 130 files

**Architecture addition:**
```
Before v1.25.0:
  reviewer rejects → coder retries (same approach) → reviewer rejects again → stall

After v1.25.0:
  reviewer rejects → Solomon evaluates rejection
    → critical issues → coder retries with targeted feedback
    → style-only issues → Solomon overrides, pipeline continues
    → mixed issues → coder retries on critical only, style deferred

TDD auto-detect:
  project has vitest/jest/mocha → methodology = "tdd" (auto)
  project has no test runner → methodology = "standard" (auto)
  --methodology flag → always wins (explicit override)

SonarQube auto-manage:
  sonar enabled + Docker not running → auto-start container
  sonar enabled + no config file → auto-generate sonar-project.properties
  sonar result = coverage-only → advisory (non-blocking)
```

**Why:** The pipeline was becoming increasingly autonomous but still required manual configuration for TDD methodology and SonarQube setup. Solomon's evolution from supervisor to Pipeline Boss addresses a key bottleneck: reviewer rejections that stall the pipeline on style-only concerns while critical issues get lost in the noise. Auto-detecting TDD and auto-managing SonarQube removes the two most common configuration friction points, making the pipeline truly zero-config for standard projects.

### v1.25.1: Auto-Simplify Pipeline

Auto-simplify pipeline: triage level 1-2 (trivial/simple) runs a lightweight coder-only flow, skipping reviewer, tester, and other post-coder stages. Level 3+ (medium/complex) gets the full pipeline. Configurable via `--no-auto-simplify` CLI flag or `autoSimplify: false` MCP parameter.

### v1.25.2: Anti-Bypass Guardrail

**v1.25.2** — Anti-bypass guardrail for `kj_resume`: validates answers against prompt injection patterns, rejects too-long inputs, defense-in-depth truncation. 36 new tests.

### v1.25.3: Provider Outage Resilience

**v1.25.3** — Provider outage resilience: 500/502/503/504 and connection errors now trigger automatic standby and retry (same as rate limits). On resume after outage, the coder is explicitly informed it was an external provider failure, not a code or KJ problem.

## Phase 20.1: Session Overrides & Solomon Style-Only Blocks (v1.24.1)

**What changed:** Fixed two issues — session overrides lost on resume, and Solomon not detecting reviewer style-only blocks.

**Key fixes:**
- Session overrides (agent assignments, flags) are now preserved when resuming a session via `kj_resume`
- Solomon Rule 6: detects when a reviewer is blocking exclusively on style/formatting issues (not logic or correctness) and auto-escalates to human review instead of stalling the pipeline

**Why:** Session overrides set via `kj_preflight` were lost on resume, causing resumed sessions to revert to default config. Solomon's existing rules caught scope and overreach issues but missed a common stall pattern: reviewers blocking on style-only concerns (naming, formatting, comment style) that are subjective and unlikely to converge through automated iteration.

## Phase 20: Impeccable Design Auditor (v1.24.0)

**What changed:** Added an automated UI/UX quality gate that audits changed frontend files for design issues, and enhanced triage and intent classifier with frontend detection.

**Key additions:**
- **Impeccable role**: 14th configurable pipeline role — automated design auditor that checks changed frontend files for accessibility, performance, theming, responsive, and anti-pattern issues. Runs after SonarQube, before reviewer. Applies fixes automatically.
- Frontend detection in triage: triage now identifies frontend tasks and auto-activates the impeccable role when appropriate
- Frontend detection in intent classifier: deterministic keyword-based frontend classification without LLM cost
- `enableImpeccable` config/CLI/MCP flag for explicit activation
- `--enable-impeccable` CLI flag for `kj run`
- `enableImpeccable` MCP parameter for `kj_run`
- 1586 tests across 130 files

**Architecture addition:**
```
Before v1.24.0:
  [coder → refactorer? → guards → TDD → sonar? → reviewer]

After v1.24.0:
  [coder → refactorer? → guards → TDD → sonar? → impeccable? → reviewer]

  impeccable:
    changed frontend files → audit for a11y, perf, theming, responsive, anti-patterns
    → auto-fix issues → report remaining issues to reviewer
```

**Why:** SonarQube catches code quality issues but misses UI/UX design problems — wrong contrast ratios, missing aria attributes, non-responsive layouts, hardcoded colors instead of theme tokens, layout shifts from images without dimensions. The impeccable role fills this gap with a specialized design audit focused exclusively on frontend quality. It runs after SonarQube (which handles code quality) and before the reviewer (which handles logic and architecture), giving the reviewer a cleaner diff to focus on. Triage auto-activates it for frontend tasks so developers don't need to remember the flag.

## Phase 19: Deterministic Guards Layer (v1.18.0)

**What changed:** Added a regex/pattern-based validation layer that complements probabilistic LLM decisions with deterministic checks. Three guards now run at different pipeline stages.

**Key additions:**
- **Output guard**: scans git diffs for destructive operations (rm -rf, DROP TABLE, git push --force, disk format), exposed credentials (AWS keys, private keys, GitHub/npm tokens), and protected file modifications (.env, serviceAccountKey.json). Blocks pipeline on critical violations. Custom patterns and protected files configurable via `guards.output`.
- **Perf guard**: scans frontend file diffs (.html, .css, .jsx, .tsx, .astro, .vue, .svelte) for performance anti-patterns — images without dimensions/lazy loading, render-blocking scripts, missing font-display, document.write, heavy dependencies (moment, lodash, jquery). Advisory by default, configurable to block via `guards.perf.block_on_warning`.
- **Intent classifier**: keyword-based deterministic pre-triage. Classifies obvious task types (doc, add-tests, refactor, infra, trivial-fix) without LLM cost. Runs before discover/triage in pre-loop. Custom patterns with configurable confidence threshold via `guards.intent`.
- Guards config schema in `kj.config.yml` with custom patterns, protected files, and thresholds
- 1505 tests across 121 files

**Architecture addition:**
```
Before v1.18.0:
  kj_run → discover? → triage → researcher? → architect? → planner? → [coder → refactorer? → TDD → sonar → reviewer]

After v1.18.0:
  kj_run → intent? → discover? → triage → researcher? → architect? → planner? → [coder → refactorer? → guards → TDD → sonar → reviewer]

  guards layer:
    output-guard: diff → scan for destructive ops + credential leaks + protected files
    perf-guard:   diff → scan frontend files for performance anti-patterns
    intent-guard: task description → keyword classification → skip LLM triage for obvious types
```

**Why:** LLM-based validation (reviewer, triage) is powerful but probabilistic — it can miss obvious patterns or hallucinate false negatives. Deterministic guards provide a fast, zero-cost, 100% reliable first line of defense for well-defined anti-patterns. The output guard prevents catastrophic mistakes (deleting files, leaking credentials). The perf guard catches common frontend performance issues that LLMs often overlook (CLS from images without dimensions, render-blocking scripts). The intent classifier saves LLM calls for tasks that are obviously documentation, tests, or refactoring — reducing latency and cost. All three are configurable with custom patterns, making them extensible without code changes.

**Future: WebPerf Quality Gate** — The static perf guard is the first phase of a planned WebPerf quality gate. The second phase will integrate dynamic performance scanning using headless Chrome, inspired by [Joan León](https://joanleon.dev/)'s [WebPerf Snippets](https://webperf-snippets.nucliweb.net/) — a collection of performance measurement snippets for Core Web Vitals, resource loading, and runtime analysis. Joan is currently building a CLI tool for this; once available, it will be integrated as a post-loop performance scanner, complementing the static guard with real runtime metrics.

## Phase 18: Architectural Design & Code Quality (v1.17.0)

**What changed:** Added a pre-construction architecture design role and resolved all SonarQube issues across the codebase, reducing cognitive complexity from 345 to 15 in the main orchestrator.

**Key additions:**
- ArchitectRole: 13th configurable pipeline role that designs solution architecture (layers, patterns, data model, API contracts, tradeoffs) between researcher and planner
- Interactive architecture pause: pipeline pauses with targeted questions when the architect detects design ambiguity (`verdict: "needs_clarification"`)
- Auto ADR generation: architectural tradeoffs are automatically persisted as Architecture Decision Records in Planning Game
- Triage → architect activation: triage auto-activates architect based on task complexity, scope, and design ambiguity
- Planner architectContext: planner generates implementation steps aligned with architectural decisions
- SonarQube full cleanup: 205 issues → 0 (CRITICAL, MAJOR, MINOR)
- Cognitive complexity refactoring: orchestrator.js (345→15), display.js (134→2), server-handlers.js (101→3), config.js (55→10)
- Handler dispatch maps: replaced large switch/if-else chains with object dispatch patterns
- 1454 tests across 118 files

**Architecture addition:**
```
Before v1.17.0:
  kj_run → discover? → triage → researcher? → planner? → coder → ...

After v1.17.0:
  kj_run → discover? → triage → researcher? → architect? → planner? → coder → ...

  architect:
    task + researchContext + discoverResult → design architecture
    → verdict: "ready" → architectContext passed to planner
    → verdict: "needs_clarification" → askQuestion → human answers → re-evaluate
    → tradeoffs[] → auto-create ADRs in Planning Game (if PG card linked)

  Cognitive complexity before/after:
    orchestrator.js:  345 → 15 (extracted 24+ helper functions)
    display.js:       134 →  2 (EVENT_HANDLERS dispatch map)
    server-handlers:  101 →  3 (toolHandlers dispatch map)
    config.js:         55 → 10 (declarative flag maps)
```

**Why:** The pipeline had a gap between understanding (researcher) and planning (planner): nobody was making architectural decisions. The coder was forced to make design choices on the fly — layer boundaries, data models, API contracts, technology tradeoffs — without validation. This led to rework when decisions didn't match stakeholder expectations. The architect role fills this gap by producing explicit, reviewable design decisions before any code is written. The SonarQube cleanup was equally important: cognitive complexity had grown unchecked as the orchestrator evolved through 17 phases. The refactoring replaced monolithic functions with composable helpers and dispatch maps, making the codebase maintainable as it continues to grow.

## Phase 17: Pre-Execution Discovery (v1.16.0)

**What changed:** Added a new pre-pipeline discovery stage that analyzes task specifications for gaps, ambiguities, and missing information before any code is written. Five specialized discovery modes provide different validation lenses.

**Key additions:**
- `DiscoverRole` extending `BaseRole` — 12th configurable pipeline role
- 5 discovery modes: `gaps` (default gap detection), `momtest` (Mom Test validation questions), `wendel` (behavior change adoption checklist), `classify` (START/STOP/DIFFERENT classification), `jtbd` (Jobs-to-be-Done generation)
- `kj_discover` MCP tool for standalone gap detection outside the pipeline
- Pipeline integration: opt-in pre-triage stage via `--enable-discover` flag or `pipeline.discover.enabled` config
- Non-blocking execution: discovery failures log warnings and continue the pipeline gracefully
- Prompt builder with mode-specific sections and JSON schema enforcement
- Output parser with field validation, severity normalization, and filtering of incomplete entries

**Architecture addition:**
```
Before v1.16.0:
  kj_run → triage → researcher? → planner? → coder → ...

After v1.16.0:
  kj_run → discover? → triage → researcher? → planner? → coder → ...

  discover (gaps mode):
    task spec → identify gaps, ambiguities, assumptions → verdict: ready | needs_validation
    → gaps[]: { id, description, severity, suggestedQuestion }

  discover (momtest mode):
    task spec → gaps + Mom Test questions (past behavior, not hypotheticals)
    → momTestQuestions[]: { gapId, question, targetRole, rationale }

  discover (wendel mode):
    task spec → 5 behavior change conditions (CUE, REACTION, EVALUATION, ABILITY, TIMING)
    → wendelChecklist[]: { condition, status: pass|fail|unknown, justification }

  discover (classify mode):
    task spec → behavior change type (START, STOP, DIFFERENT, not_applicable)
    → classification: { type, adoptionRisk, frictionEstimate }

  discover (jtbd mode):
    task spec + context → reinforced Jobs-to-be-Done
    → jtbds[]: { id, functional, emotionalPersonal, emotionalSocial, behaviorChange, evidence }

Standalone:
  kj_discover(task, mode) → structured discovery output (no pipeline execution)
```

**Why:** AI-generated code is only as good as its input specification. When tasks are ambiguous or incomplete, the coder agent makes assumptions that may not match the stakeholder's intent — leading to rework cycles. The discovery stage catches these gaps before any code is written, when the cost of clarification is lowest. The five modes provide different validation lenses: `gaps` for technical completeness, `momtest` for stakeholder validation, `wendel` for adoption readiness, `classify` for change impact assessment, and `jtbd` for understanding the underlying user needs. Discovery is opt-in and non-blocking to avoid adding friction to well-defined tasks.

## Phase 16: Policy-Driven Pipeline (v1.14.0)

**What changed:** The pipeline now dynamically enables or disables stages based on task type, replacing the one-size-fits-all approach with policy-driven configuration.

**Key additions:**
- New `src/guards/policy-resolver.js` module: maps each `taskType` to a set of pipeline policies (tdd, sonar, reviewer, testsRequired)
- 5 built-in task types: `sw` (software), `infra`, `doc`, `add-tests`, `refactor` — each with appropriate stage defaults
- Config overrides via `policies` section in `kj.config.yml` — projects can customize which stages apply per task type
- Orchestrator applies policy gates with config immutability: shallow copies ensure the caller's configuration is never mutated
- `policies:resolved` event emitted after resolution, enabling downstream consumers to react to the active policy set
- Unknown or missing `taskType` defaults to `sw` (most conservative)
- Mandatory triage with taskType classification (v1.15.0)
- `--taskType` CLI/MCP parameter for explicit override
- Triage → policy-resolver integration chain

**Architecture addition:**
```
Before v1.14.0:
  kj_run → all stages enabled based on static config
  infra task → TDD check fails → pipeline stalls on irrelevant gate

After v1.14.0:
  kj_run(taskType: "infra") → policy-resolver → { tdd: false, sonar: false, reviewer: true }
  kj_run(taskType: "sw")    → policy-resolver → { tdd: true, sonar: true, reviewer: true }
  kj_run(taskType: null)    → policy-resolver → defaults to "sw" (most conservative)

Override flow:
  built-in defaults → merge with kj.config.yml policies section → shallow copy → apply gates
```

**Why:** Not all tasks benefit from the same pipeline stages. Running TDD checks on infrastructure tasks (CI configs, Dockerfiles) or documentation tasks produces false positives and wastes time. Running SonarQube on pure documentation changes is meaningless. The policy-resolver lets the pipeline adapt its quality gates to the nature of the work, while defaulting to the most conservative profile (`sw`) when the task type is unknown — ensuring safety without sacrificing flexibility.

## Phase 15: BecarIA Gateway (v1.13.0)

**What changed:** Full CI/CD integration with GitHub PRs as the single source of truth. All pipeline agents now post their results directly on PRs, and the pipeline creates PRs early in the process.

**Key additions:**
- BecarIA Gateway: GitHub PRs become the central coordination point for all agents
- Early PR creation: draft PR created after the first coder iteration
- Agent PR comments/reviews: all agents (Coder, Reviewer, Sonar, Solomon, Tester, Security, Planner) post results as PR comments or reviews
- Configurable dispatch events via `becaria` config section — trigger GitHub Actions workflows at each pipeline stage
- `kj review` standalone with PR diff support — usable as an independent code review tool
- Embedded workflow templates: `kj init --scaffold-becaria` generates `becaria-gateway.yml`, `automerge.yml`, `houston-override.yml`
- `kj doctor` BecarIA checks: verifies workflow templates and GitHub token permissions
- `--enable-becaria` CLI flag and `enableBecaria` MCP parameter

**Architecture addition:**
```
Before v1.13.0 (local pipeline):
  coder → sonar → reviewer → commiter → manual PR creation

After v1.13.0 (BecarIA Gateway):
  coder (iteration 1) → create draft PR
  coder → post comment on PR
  sonar → post comment on PR
  reviewer → post review on PR
  solomon → post comment on PR
  tester → post comment on PR
  security → post comment on PR
  dispatch events → GitHub Actions workflows

kj init --scaffold-becaria:
  → .github/workflows/becaria-gateway.yml
  → .github/workflows/automerge.yml
  → .github/workflows/houston-override.yml
```

**Why:** Local-only pipelines required manual steps to bridge the gap between AI-generated code and team collaboration. PRs are the natural collaboration point for code review and CI/CD, but creating them was a manual afterthought. BecarIA Gateway makes PRs the first-class integration point: agents post their findings where the team already works, dispatch events trigger existing CI/CD workflows, and the early PR creation ensures visibility from the first iteration. This transforms Karajan from a local orchestrator into a CI/CD-aware pipeline that integrates seamlessly with GitHub-based workflows.

## Phase 14: Intelligent Reviewer Mediation (v1.12.0)

**What changed:** The pipeline now intelligently handles reviewer blocking issues that fall outside the current diff's scope, instead of stalling or stopping.

**Key additions:**
- Reviewer scope filter: automatically detects when a reviewer raises blocking issues about files not in the current diff
- Deferred issues tracking: out-of-scope blocking issues are auto-deferred and stored in the session's `deferredIssues` field as tech debt
- Coder feedback loop: deferred issues are fed back into the coder prompt on subsequent iterations for awareness
- Solomon `reviewer_overreach` rule: 5th built-in rule that detects when a reviewer is blocking on out-of-scope files
- Solomon reviewer mediation: instead of immediately stopping on reviewer stalls, Solomon evaluates and mediates

**Architecture addition:**
```
Reviewer raises blocking issue on file outside diff:
  scope filter → issue is out-of-scope
    → auto-defer (pipeline continues)
    → store in session.deferredIssues
    → inject into next coder prompt as tech debt context

Solomon mediation (reviewer stall):
  reviewer blocks → Solomon evaluates → overreach? → defer + continue
                                       → legitimate? → pause for human
```

**Why:** Reviewers frequently flag pre-existing problems in files the coder never touched, causing the pipeline to loop indefinitely on issues that cannot be resolved within the current task's scope. The scope filter breaks this loop by deferring out-of-scope issues while preserving them as tracked tech debt. Solomon's mediation role ensures the pipeline is resilient to reviewer overreach without losing visibility into legitimate concerns.

## Phase 13: Pipeline Intelligence & Human Sovereignty (v1.11.0)

**What changed:** Transformed from a passive pipeline executor into an intelligent orchestrator with human-first governance. Triage, tester, security, and Solomon are now on by default. Preflight handshake prevents AI agents from overriding human config decisions.

**Key additions:**
- Triage as pipeline director: analyzes task complexity and returns JSON with role activation decisions per task
- Tester and security enabled by default — every task gets tested and security-audited
- Solomon supervisor: runs after each iteration with 4 built-in rules (max_files, stale_iterations, dependency_guard, scope_guard), pauses on critical alerts
- Preflight handshake (`kj_preflight`): mandatory human confirmation before `kj_run`/`kj_code` executes — blocks AI from changing agents silently
- Session-scoped agent config: `kj_agents` via MCP defaults to session scope (in-memory), CLI defaults to project scope
- 3-tier config merge: DEFAULTS < global (`~/.karajan/`) < project (`.karajan/`)
- Rate-limit standby with auto-retry: parses cooldown from 5 error patterns, waits with exponential backoff (5min default, 30min max), emits standby/heartbeat/resume events, max 5 retries before human pause
- MCP progress streaming extended to `kj_code`, `kj_review`, `kj_plan` (was only `kj_run`)
- Enhanced `kj_status`: parsed status summary (currentStage, currentAgent, iteration, isRunning, errors)
- `kj-tail` resilient tracking with `tail -F`
- 1180 tests across 106 files

**Architecture addition:**
```
Before v1.11.0:
  AI calls kj_run(coder: "codex") → Karajan runs codex, no questions asked

After v1.11.0:
  AI calls kj_run → BLOCKED (preflight required)
  AI calls kj_preflight → shows config to human → human says "ok" or adjusts
  AI calls kj_run → triage evaluates task → activates roles → coder → solomon check → reviewer → tester → security

Rate-limit standby:
  coder hits rate limit → parse cooldown → wait (backoff) → retry same iteration
  5 consecutive retries → pause for human

Solomon supervisor:
  after each iteration → evaluate 4 rules → warning/critical
  critical → pause + ask human via elicitInput
```

**Why:** Running AI-generated code without testing or security checks was unacceptable ("vaya mierda de código"). Triage as director ensures the right roles activate for each task's complexity. The preflight handshake solved a fundamental trust issue: when an AI agent passes `coder: "codex"` to `kj_run`, there was no way to know if the human chose that or the AI decided on its own. Now the human explicitly confirms or adjusts before anything runs.

## Phase 12: Runtime Agent Management & Session Resilience (v1.10.0)

**What changed:** Added runtime agent swapping per pipeline role, expanded session resumability, and hardened subprocess reliability.

**Key additions:**
- `kj_agents` MCP tool and `kj agents` CLI command: list or set the AI agent per pipeline role on the fly (`kj agents set coder gemini`), persists to `kj.config.yml`, no restart needed
- Checkpoint resilience: null/empty `elicitInput` response defaults to "continue 5 min" instead of killing the session
- `kj_resume` expanded: now accepts stopped and failed sessions, not just paused ones
- Subprocess constraints: coder prompt tells the agent it is non-interactive — use `--yes`/`--no-input` flags or report inability
- `kj doctor` version: shows Karajan Code version as first check line
- 1084 tests total
- Planning Game auto-status (v1.10.1): when `kj_run` has a `pgTaskId`, automatically marks the card as "In Progress" at start and "To Validate" on completion — works from both CLI and MCP
- 1090 tests total (v1.10.1)

**Architecture addition:**
```
kj agents set coder gemini
    └─ update kj.config.yml (roles.coder.agent = "gemini")
    └─ next kj_run / kj_code picks up new agent — no MCP restart

kj_resume (v1.10.0):
    paused sessions  ──→ resume (as before)
    stopped sessions ──→ resume (new)
    failed sessions  ──→ resume (new)
```

**Why:** Users needed to switch agents mid-session without restarting the MCP server or editing config files manually. The expanded `kj_resume` means sessions that stopped or failed due to transient issues (rate limits, network errors) can be recovered instead of abandoned. Subprocess constraints prevent agents from hanging on interactive prompts that will never receive input.

## Phase 11: Planner Reliability & MCP Lifecycle Hardening (v1.9 - v1.9.6)

**What changed:** Strengthened `kj_plan` anti-hang behavior and clarified MCP lifecycle during upgrades.

**Key additions:**
- Planner guardrails promoted and documented: `session.max_agent_silence_minutes` and `session.max_planner_minutes` prevent silent or runaway planning executions
- Better planner diagnostics in MCP responses/logs: clearer failure categories and actionable suggestions when stalls/timeouts happen
- MCP lifecycle hardening for upgrades: stale server processes exit after version changes so hosts reconnect with fresh code instead of running mixed versions
- Operational troubleshooting guidance added for the expected `Transport closed` scenario after updates
- Branch guard for MCP tools: `kj_run`, `kj_code`, and `kj_review` reject execution when on the base branch to avoid empty diffs (v1.9.4)
- Claude subprocess compatibility: strips `CLAUDECODE` env var, detaches stdin, and reads structured output from stderr where Claude Code 2.x writes it (v1.9.5-v1.9.6)

**Architecture addition:**
```
MCP host session (old process)
    └─ package version changes
        └─ stale karajan-mcp exits
            └─ host reconnects and spawns fresh version
```

**Why:** Long planning prompts can look "stuck" when an agent stays silent for too long, and upgrades can leave MCP hosts attached to stale processes. v1.9.x also focused on operational reliability: fail fast with useful diagnostics, and make MCP process lifecycle predictable after version bumps.

## Phase 10: Pipeline Stage Tracker (v1.8)

**What changed:** Added cumulative pipeline progress tracking — a single event showing the full state of all stages after every transition.

**Key additions:**
- `pipeline:tracker` event emitted after every stage transition during `kj_run`, with cumulative state (done/running/pending/failed) for all pipeline stages
- Single-agent progress logging: `kj_code`, `kj_review`, `kj_plan` emit tracker start/end logs so MCP hosts can show which agent is active
- CLI rendering: `kj run` displays a cumulative pipeline box with status icons per stage
- `buildPipelineTracker(config, emitter)` builds stage list from config and self-registers on the event emitter
- `sendTrackerLog(server, stageName, status, summary)` helper for single-agent handlers

**Architecture addition:**
```
kj_run pipeline events (before v1.8):
  coder:start → coder:end → sonar:start → sonar:end → reviewer:start → ...
  (host must reconstruct state from individual events)

kj_run pipeline events (v1.8+):
  coder:start → pipeline:tracker { stages: [{coder: running}, {sonar: pending}, ...] }
  coder:end   → pipeline:tracker { stages: [{coder: done}, {sonar: pending}, ...] }
  sonar:start → pipeline:tracker { stages: [{coder: done}, {sonar: running}, ...] }
  (host receives full state in every event — no reconstruction needed)
```

**Why:** MCP hosts received individual `*:start`/`*:end` events but had no cumulative view. Each host had to maintain its own state machine to reconstruct pipeline progress. The tracker centralizes this logic — one event, one snapshot, zero host-side state management. For single-agent tools (`kj_code`/`kj_review`/`kj_plan`), there was previously zero progress feedback; now hosts see start/end tracker logs.

## Phase 9: In-Process MCP Handlers (v1.7)

**What changed:** Moved `kj_code`, `kj_review`, and `kj_plan` from subprocess execution to in-process execution within the MCP server, and added automatic version-based restart.

**Key additions:**
- In-process execution: `kj_code`, `kj_review`, `kj_plan` now run inside the MCP server process (like `kj_run`), eliminating subprocess timeouts that killed tasks via SIGKILL
- Version watcher: `setupVersionWatcher` detects `package.json` version changes after `npm link`/`npm install` and exits cleanly so the MCP host restarts with fresh code
- Per-call version check as fallback for the watcher
- Dynamic version reads from `package.json` instead of hardcoded strings

**Why:** The subprocess model imposed a timeout via execa that killed agents mid-work with SIGKILL. In-process execution gives agents unlimited time — the orchestrator manages lifecycle, not the process manager. The version watcher solved a painful development issue: ESM module caching meant the MCP server kept running old code after updates.

## Phase 8: Interactive Checkpoints & Task Decomposition (v1.6)

**What changed:** Replaced the hard timeout that killed running processes with an interactive checkpoint system, and added automatic task decomposition with Planning Game integration.

**Key additions:**
- Interactive checkpoints: every 5 minutes (configurable with `--checkpoint-interval`), pauses execution with a progress report and asks the user to continue (5 more min / until done / custom time / stop)
- Only applies when `askQuestion` is available (MCP `kj_run`); subprocess commands (`kj_code`, `kj_review`) run without timeout by default
- Triage task decomposition: analyzes whether tasks should be split, returning `shouldDecompose` and `subtasks[]` fields
- PG subtask creation: when triage recommends decomposition and a Planning Game card is linked, creates subtask cards with `blocks/blockedBy` chain relationships
- Planner receives decomposition context, focusing on the first subtask
- PR body enrichment with approach, steps, and pending subtasks as checkboxes
- Provider and model tracking in all session checkpoints

**Architecture addition:**
```
MCP kj_run:
  iteration loop
    ├── checkpoint timer (every N min)
    │     └── askQuestion → continue / stop / adjust
    ├── coder → sonar → reviewer
    └── next iteration

Triage decomposition:
  triage → shouldDecompose: true, subtasks: [...]
         → askQuestion("Create PG subtasks?")
         → PG API: createCard × N → relateCards (blocks chain)
```

**Why:** The hard timeout was a blunt instrument — it killed the process regardless of progress, losing all work. Interactive checkpoints give the user control: see what's been done, decide whether to continue, and adjust timing. Task decomposition prevents overloading a single pipeline run with work that should be multiple sequential tasks.

## Phase 7: Smart Model Selection (v1.5)

**What changed:** Automatic model selection per role based on triage complexity — lighter models for trivial tasks, powerful models for complex ones.

**Key additions:**
- Smart model selection: triage classifies complexity (trivial/simple/medium/complex), then `model-selector.js` maps each role to the optimal model
- Default tier map: trivial → haiku/flash/o4-mini, complex → opus/pro/o3
- Role overrides: reviewer always uses at least "medium" tier for quality; triage always uses lightweight models
- Explicit CLI flags (`--coder-model`, `--reviewer-model`) always take precedence over smart selection
- CLI flags: `--smart-models` / `--no-smart-models`
- MCP parameter: `smartModels` for `kj_run`
- User-configurable tiers and role overrides via `model_selection` in `kj.config.yml`

**Architecture addition:**
```
triage → level ("simple")
       → model-selector → { coder: "claude/haiku", reviewer: "claude/sonnet" }
       → config.roles.*.model populated (only null slots — CLI flags win)
       → agents pass --model flag as usual
```

**Why:** Not all tasks deserve the most powerful (and slowest) model. A typo fix doesn't need Opus, and a complex refactor shouldn't use Haiku. Smart selection optimizes three things: speed (lighter models respond faster), quality (complex tasks get powerful models), and token quota usage (lighter models consume less of your subscription window, reducing rate limit risk).

## Phase 6: Resilience (v1.4)

**What changed:** Automatic detection and handling of CLI agent rate limits, with seamless fallback to alternative agents.

**Key additions:**
- Rate limit detection: pattern matching on agent stderr/stdout for all supported agents (Claude, Codex, Gemini, Aider)
- Session pause on rate limit instead of failure — resume with `kj resume` when the token window resets
- Auto-fallback: when the primary coder agent hits a rate limit, automatically switch to a configured fallback agent
- `--coder-fallback` CLI flag and `coder_options.fallback_coder` config option
- Checkpoint tracking for each fallback attempt

**Architecture addition:**
```
coder (primary) ──rate limit──→ coder (fallback) ──rate limit──→ session pause
       │                              │
       ok                             ok
       ↓                              ↓
    continue                       continue
```

**Why:** CLI agents running under subscription plans (Claude Pro, Codex, etc.) can hit usage caps mid-pipeline. Previously this caused the session to fail, losing progress. Now Karajan detects rate limits, tries an alternative agent, and only pauses as a last resort — preserving session state for seamless resumption.

## Phase 5: Extensibility (v1.3)

**What changed:** Plugin system, Planning Game integration, and production hardening.

**Key additions:**
- Plugin system: `.karajan/plugins/*.js` for custom agents
- Planning Game MCP integration (card enrichment, status updates)
- Retry with exponential backoff and jitter
- Session cleanup (auto-expire old sessions)
- Git automation (auto-commit, auto-push, auto-PR, auto-rebase)
- Reviewer fallback chain (primary → fallback → Solomon)
- Environment variable overrides (`KJ_HOME`, `KJ_SONAR_TOKEN`)

**Why:** Users needed to integrate Karajan into their existing workflows — project management (Planning Game), custom AI tools (plugins), and CI/CD (git automation). The plugin system was particularly important: it allows anyone to wrap their own CLI tool as a Karajan agent without modifying the core codebase.

## Phase 4: MCP Server (v1.2)

**What changed:** Added a Model Context Protocol (MCP) server so Karajan can be used from within AI agents (Claude Code, Codex) rather than only from the terminal.

**Key additions:**
- MCP stdio server with 11 tools (kj_run, kj_code, kj_review, etc.)
- Real-time progress notifications via MCP logging
- Auto-registration in Claude Code and Codex
- Orphan guard to prevent zombie processes
- Session pause/resume via MCP (`kj_resume`)

**Architecture addition:**
```
┌──────────────────┐
│ AI Agent (Claude) │
│                  │──── MCP (stdio) ────→ karajan-mcp ──→ CLI subprocess
│                  │←─── progress/result ─┘
└──────────────────┘
```

**Why:** The most powerful way to use Karajan is not from the terminal, but from within an AI agent's conversation. The MCP server lets Claude or Codex delegate complex tasks to Karajan's pipeline, receive real-time progress updates, and get structured results — all without leaving the conversation.

## Phase 3: Role-Based Pipeline (v1.1)

**What changed:** Refactored from a monolithic orchestrator to a role-based architecture. Each pipeline responsibility became a discrete role with its own instructions, agent, and model.

**Key additions:**
- `BaseRole` abstraction (init → execute → report lifecycle)
- `BaseAgent` abstraction (uniform interface for all CLI agents)
- Agent registry (register, create, resolve)
- 12 configurable roles: discover, triage, researcher, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter
- Review profiles (standard, strict, paranoid, relaxed)
- Role instructions as markdown templates (overridable)
- Repeat detection and fail-fast logic
- Solomon escalation for conflict resolution
- Budget tracking with estimated costs

**Architecture:**
```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer
                                                                      ↓
                                                         tester? → security? → commiter?
```

**Why:** The monolithic orchestrator had become difficult to maintain and extend. Adding a new capability (like security audits) meant modifying the core loop. The role-based pattern made each responsibility independently testable and configurable.

**Inspiration:** [jorgecasar/legacy-s-end-2/packages/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) uses a clean hexagonal architecture with:
- **Domain layer**: Models and port interfaces
- **Use-cases**: plan-issue, implement-issue, review-pr, check-task-readiness, track-cost-report
- **Infrastructure**: Adapters for Anthropic, Gemini, OpenAI, GitHub, GitCli

This influenced Karajan's separation between the agent interface (`BaseAgent` as port) and concrete implementations (Claude, Codex, Gemini, Aider as adapters). The role system parallels the use-case layer — each role is a self-contained orchestration unit.

## Phase 2: Quality Gates (v1.0)

**What changed:** Added SonarQube static analysis as a mandatory step between coding and reviewing. Added TDD enforcement to ensure tests are written alongside code.

**Key additions:**
- SonarQube Docker integration (auto-start, scan, quality gate enforcement)
- TDD policy check (source changes require test changes)
- Configuration file (`kj.config.yml`) with first defaults
- Session tracking (basic run metadata)

**Architecture:**
```
task → coder → sonar → reviewer → done
                         ↑          │
                         └── loop ──┘
```

**Why:** Raw AI-generated code without quality gates often introduced code smells, skipped tests, or had security issues. SonarQube provided an objective, automated quality check independent of the reviewer.

## Phase 1: Simple Orchestrator (v0.x)

**What it was:** A single script that ran Claude CLI on a task, then ran Codex CLI to review the output. No config, no sessions, no quality gates.

**Architecture:**
```
task → claude → diff → codex review → done
```

**Limitations:**
- Hardcoded to two agents (Claude + Codex)
- No retry on failure
- No cost tracking
- No SonarQube or testing integration
- Monolithic script, hard to extend

## Key Architectural Decisions

### CLI wrapping vs direct API calls

Karajan wraps existing AI agent CLIs (claude, codex, gemini, aider) rather than calling AI provider APIs directly.

**Advantages:**
- Uses your existing subscriptions — no separate API keys needed
- Predictable cost — you pay your plan rate, not per-token
- Agents handle their own context management, tool use, and safety features
- Upgrades automatically when you update the CLI

**Trade-offs:**
- Less granular control over prompts and parameters
- Cost tracking is estimated, not actual billing
- Rate limiting is detected by Karajan (v1.4+) with automatic fallback and session pause

### Markdown-based role instructions

Role instructions (what to do, how to review, what rules to enforce) are stored as `.md` files, not hardcoded.

**Advantages:**
- Users can override any role without touching code
- Three-level resolution: project → user → built-in
- Easy to version control and share
- Non-developers can modify review rules

### Session persistence on disk

All session state is written to disk as JSON files, not kept in memory.

**Advantages:**
- Survives crashes and restarts
- Enables pause/resume across sessions
- Enables post-run reporting and audit trails
- No database dependency

### Estimated budget tracking

Token usage is counted and costs are estimated using published pricing rates, rather than querying actual API billing.

**Advantages:**
- Works with CLI agents that don't expose billing data
- Provides relative cost comparison between approaches
- Enables budget guardrails (warn at 80%, stop at 100%)

**Trade-off:** Reported costs are approximate — useful for comparison and guardrails, not for invoicing.

## References

- [jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) — Hexagonal architecture patterns (ports & adapters) that influenced the agent adapter design
- [Joan León](https://joanleon.dev/) — [WebPerf Snippets](https://webperf-snippets.nucliweb.net/) for Core Web Vitals measurement, inspiring the future WebPerf quality gate
- [ADR-001: Role-Based AI Architecture](/docs/architecture/overview/) — Architecture decision record in the karajan-code repository
- [Model Context Protocol](https://modelcontextprotocol.io/) — The standard used for Karajan's MCP server integration
