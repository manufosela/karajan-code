# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
