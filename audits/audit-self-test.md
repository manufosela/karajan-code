# Karajan Audit Report

- **Generated:** 2026-05-04T08:56:21.670Z
- **Project:** /home/manu/ws_npm-packages/karajan-code
- **Branch:** main
- **Commit:** 05d081f8
- **Invocation:** `kj audit`

---
## Codebase Health Report
**Overall Health:** good
**Total Findings:** 30 (0 critical, 3 high, 11 medium, 16 low)

### Security — Score: B
  - [MEDIUM] packages/hu-board/src/routes/api.js:823 [path-traversal-defense-in-depth]
    GET /api/runs/:commandId/log builds the file path with path.join(runsDir, `${req.params.commandId}.log`) without verifying the resolved path stays inside runsDir. Express route params can't contain '/', so a direct ../ traversal is hard, but there is no containment check (path.resolve + startsWith). Same shape at line 593 for /api/plans/:planId/log.
    Fix: After path.join, do `const resolved = path.resolve(logPath); if (!resolved.startsWith(path.resolve(runsDir) + path.sep)) return res.status(400)…`. Reject any param containing '..' or null bytes up front.
  - [MEDIUM] packages/hu-board/src/server.js:82 [default-bind-all-interfaces]
    app.listen(port, ...) is called without a host argument, so Express binds 0.0.0.0 by default. Combined with the auth middleware being opt-in only (HU_BOARD_TOKEN env var, src/auth.js:21 — `if (!expected) return next()`), every laptop on the same Wi-Fi can read/mutate the local HU board.
    Fix: Bind to '127.0.0.1' by default and require an explicit HU_BOARD_HOST=0.0.0.0 to expose. Document the trade-off in README.
  - [LOW] packages/hu-board/src/auth.js:27 [timing-attack-token-comparison]
    Bearer-token comparison uses `token === expected` (string equality), which short-circuits on the first different char.
    Fix: Switch to `crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))` after a length check; falls back gracefully when env var is unset.
  - [LOW] packages/hu-board/public/app.js:310 [inline-event-handlers-with-interpolation]
    12 places build inline `onclick="…('${esc(value)}')…"` handlers via template strings. esc() encodes HTML entities (good for HTML context) but the value lands inside a JS string literal; the manual `.replace(/'/g, '&#39;')` patches some cases but the pattern is fragile and inconsistent.
    Fix: Replace inline onclick attributes with addEventListener after innerHTML render (the file already does this for run-plan-btn at line 463). Centralise the click delegation per container instead of per row.
  - [LOW] src/agents/claude-agent.js [subprocess-env-leak]
    Multiple agents spawn child processes inheriting full process.env. Any secret added to the parent's env (CI, sonar token, OpenAI key, etc.) is automatically passed to every subprocess including third-party CLIs (claude, codex, gemini, aider, opencode).
    Fix: Whitelist forwarded env vars per agent (PATH, HOME, plus an agent-specific allowlist) instead of spreading process.env.

### Code Quality — Score: B
  - [HIGH] packages/hu-board/public/app.js:1 [god-module]
    Single 3428-line file owns rendering for board/dashboard/graph/sessions/modals, all event wiring, and global state. Inline styles, inline onclick, and deeply nested innerHTML templates compound. Without a build step there is no module boundary to enforce.
    Fix: Split per view (board.view.js, dashboard.view.js, graph.view.js, modals.js) and adopt either ES module imports with <script type=module> or a tiny templating helper. The cost of every future feature lands here.
  - [MEDIUM] src/orchestrator/flow-runner.js:1589 [long-function]
    _runFlowInner spans ~161 lines, exceeding the 50-line guideline. Although flow-runner.js was recently extracted (v2.7.4 driver split) the inner function still concentrates init + dispatch + finalisation.
    Fix: Extract pre-loop / loop / post-loop into drivers (drivers/init-context.js, iteration-loop.js already exist) and let _runFlowInner be a top-level pipeline composition with the side effects collected at the end.
  - [MEDIUM] src/orchestrator/hu-sub-pipeline.js:2096 [long-function]
    runSingleHu is ~138 lines. Same pattern as flow-runner — the iteration body, status persistence, and emitter wiring are interleaved.
    Fix: Pull status-transition logic and outcome-blob construction into pure helpers; keep runSingleHu as a thin coordinator.
  - [MEDIUM] package.json [stale-dev-dependencies]
    Basal-cost report flags 4 unused devDeps. Verified: postject is used by scripts/build-sea.mjs (false positive), @vitest/coverage-v8 is used in vitest.config.js (false positive), simple-git-hooks is wired via the simple-git-hooks field (false positive). @changesets/cli has no observable use in repo (.changeset/ exists but no workflow consumes it; PR #360 still pending per memory).
    Fix: Either land changesets workflow now or drop @changesets/cli + .changeset/ until you do — the placeholder is contributing dependency tree weight.
  - [LOW] tests/_diet/basic-reporter.js [dead-export]
    Basal-cost report identifies 4 dead exports across test fixtures (BasicReporter, REVIEW_BLOCKING, mockCreateAgent, register).
    Fix: Delete unreferenced fixtures; if they are intentional fixture entry points, document that or expose them through tests/fixtures/index.js.
  - [LOW] src [console-log-as-logger]
    282 console.log call-sites across src/. For a CLI tool this is mostly fine, but it intermixes user-facing output with structured journal/event emitter calls and makes silent-mode harder.
    Fix: Route any user-facing output through a thin Logger interface (display.js / event-emitter already exist) so vitest can spy on it and silent/json modes can mute it cleanly.
  - [LOW] packages/hu-board/public/app.js:419 [inline-styles-duplication]
    Numerous inline `style="…"` blocks across the renderers duplicate the same rules (margin/padding/colors). The CSS file exists (styles.css) but is bypassed for component-local rules.
    Fix: Move repeating clusters into BEM-style classes in styles.css. Inline styles defeat caching and theme variables.
  - [LOW] src [files-over-300-lines]
    28 source files exceed 300 lines (none exceed 500). Acceptable but a watch-list as the codebase grows.
    Fix: On next refactor pass continue the drivers/ pattern: extract single-concern helpers from hu-sub-pipeline.js (486), direct-handlers.js (483), post-loop-stages.js (468), config-init.js (468).

### Performance — Score: B
  - [LOW] src/mcp/orphan-guard.js:1 [sync-io-in-long-process]
    Uses readFileSync/writeFileSync/watch in the MCP server boot path. The MCP server is a long-running process; sync I/O blocks the event loop for the duration of the call.
    Fix: Switch to fs/promises for hot paths; keep sync calls only inside boot/cli scripts where the process is short-lived.
  - [LOW] packages/hu-board/public/app.js:256 [full-innerHTML-rerender]
    Each view switch (renderBoard / renderDashboard / renderGraph) writes a full app.innerHTML, throwing away any DOM state and forcing a full reflow.
    Fix: Use fragment-level updates (replaceChildren on the modified column) and keep the static chrome static; especially relevant for the kanban which reflows on every poll.
  - [LOW] src [no-budgeted-cache]
    Several CLI commands (audit, plan, report) do repeated git/filesystem scans without memoisation across stages within the same run.
    Fix: Use the existing run-context (src/utils/run-context.js) to memoise per-run scans (git diff, ls of plans, sonar config resolution).

### Architecture — Score: B
  - [MEDIUM] src/orchestrator [no-formal-DI]
    The orchestrator manually threads ~10 collaborators (config, logger, emitter, eventBase, askQuestion, runIterationFn, etc.) through every stage. The recent v2.6.0 DI work (memory) introduced a container, but stages are still passed as positional/parameter bags.
    Fix: Standardise on a single PipelineContext object built once in init-context.js and passed by reference; add a typed JSDoc typedef so editors flag missing fields.
  - [LOW] src [circular-dep-risk]
    src/commands/run.js imports from src/orchestrator/* and src/orchestrator imports indirectly from src/commands/* via shared utilities. Static analysis was not available (madge not installed) so this is a heuristic risk only.
    Fix: Add `madge --circular src` to the validate npm script or to CI; it has zero install cost and catches the regression early.
  - [LOW] src [config-fragmentation]
    Configuration spans kj.config.yml, package.json scripts, eslint.config.js, vitest.config.js, sonar-project.properties, .kj-ready.json. Each is appropriate, but there is no central README index of where each setting lives.
    Fix: Add a docs/CONFIG-MAP.md or a section in ARCHITECTURE.md listing each config file and its scope.
  - [LOW] src/audit/basal-cost.js [no-architecture-tests-on-board]
    There are architecture tests for the orchestrator (tests/architecture/session-write-boundary.test.js per the file's comment). The HU board package has no equivalent — public/app.js is unconstrained.
    Fix: Add a minimal architecture test for packages/hu-board (e.g. forbid `import` between view modules once they are split).

### Testing — Score: B
  - [MEDIUM] coverage/index.html [coverage-below-target]
    Latest coverage report: 78.62% statements, 69.41% branches, 82.11% functions, 79.88% lines. Branch coverage notably below the 80% project guideline.
    Fix: Focus next-iteration tests on uncovered branches in src/orchestrator/* and src/sonar/* (none of sonar/* has same-name test files).
  - [MEDIUM] src [missing-unit-tests]
    138 of 321 source files (43%) lack a same-name test file. Many are likely covered by integration/e2e suites, but specific gaps include src/sonar/* (8 files, 0 tests), src/cli/register-*.js (5 files, 0 tests), src/plan/* (5 files, 0 tests).
    Fix: Map the gap to actual coverage: anything below 60% line coverage AND lacking a unit test is a real hole, the rest is fine.
  - [LOW] tests [setTimeout-in-tests]
    35 setTimeout/sleep occurrences in tests. Most use 2-10ms delays to advance event-loop ordering — usually fine but a flake source as CI machines vary.
    Fix: Replace fixed delays with await-on-emitter patterns (e.g. once(emitter, 'event')) or vi.runAllTicks/vi.useFakeTimers wherever feasible.

### Accessibility (WCAG 2.x) — Score: C
  - [HIGH] packages/hu-board/public/index.html:18 [icon-only-buttons-no-aria-label]
    Header control buttons (⚙ ⚡ 🔁 🔄 at lines 32-35) and many generated buttons in app.js (✕ remove-test, ✎ rename, 🗑️ delete-project, ▶ run, ⚙ running-badge, 📜 view-log, ⟳ refresh in pipeline.html) have only a `title` attribute. title is not consistently announced by assistive tech and is invisible on touch devices.
    Fix: Add `aria-label` to every icon-only button. The fastest pattern: `<button aria-label="Re-scan disk for new batches" title="Re-scan disk for new batches">🔄</button>` (keep title for sighted hover hint).
  - [HIGH] packages/hu-board/public/index.html:1 [missing-h1]
    index.html has no `<h1>` element. The visual title is rendered as `<div class="header__title">Karajan HU Board</div>` (line 18). Screen readers and outline tools see a page with no top-level heading.
    Fix: Replace the div with `<h1 class="header__title">Karajan HU Board</h1>`. CSS can keep the same look.
  - [MEDIUM] packages/hu-board/public/index.html:28 [select-without-label]
    `<select id="project-select">` has no associated `<label>` and no `aria-label`. Same issue for the per-test `<select data-field="type">` and the nested form selects/textareas in app.js (lines 2128, 2176, 2182, 2185) that rely on placeholder or sibling text only.
    Fix: Either visually associate a `<label for="project-select">Project</label>` (visually hidden if needed) or add `aria-label="Select project"`. Same for every form control inside generated modals.
  - [MEDIUM] packages/hu-board/public/app.js:1915 [modal-no-focus-management]
    Modal close buttons use `<button class="modal__close" onclick="closeModal()">&times;</button>` with no aria-label, and there is no visible focus-trap, focus-restore-on-close, or `role="dialog"`/`aria-modal="true"` on the modal container (#modal-content at index.html:48).
    Fix: Add role="dialog" + aria-modal="true" + aria-labelledby pointing to the modal title; wire a focus trap (e.g. focus-trap-js or 30 lines of vanilla); restore focus to the trigger on close. Add aria-label="Close" to ×.
  - [MEDIUM] packages/hu-board/public/index.html:11 [missing-landmark-and-skip-link]
    Header is `<header>` and main is `<main>` (good), but there is no skip-to-content link, no `<nav>` (nav-btn buttons are wrapped in `<nav class="header__nav">` — actually OK), and `<main id="app">` swaps its contents on every view but never gets a refreshed `aria-label` or live region for status changes.
    Fix: Add a visually-hidden 'Skip to content' anchor as the first focusable element. Set `aria-live="polite"` on the running-badge / loading region so screen reader users hear status changes.
  - [LOW] packages/hu-board/public/app.js:233 [no-color-only-fallback-in-status]
    Status pills (running / done / failed / blocked) appear to be coloured with var(--color-yellow|green|...) only; without seeing the runtime DOM I cannot confirm whether each variant also carries a text label or icon. Static finding only — needs an axe-core/Lighthouse runtime check.
    Fix: Run an axe-core scan on the dev server (kj board start, then `npx axe http://localhost:4000/`); flag every WCAG 1.4.1 violation.
  - [LOW] packages/hu-board/public/styles.css [static-contrast-suspect]
    Theme tokens (var(--text-muted), var(--bg-secondary), var(--color-yellow)) are referenced in inline styles. I could not statically determine the rendered contrast ratios.
    Fix: Run the same axe/Lighthouse pass with both light/dark themes active; resolve any contrast pair below 4.5:1 (text) or 3:1 (UI).

## Top Recommendations

1. [accessibility] Add aria-label to every icon-only button in index.html and app.js (⚙ ⚡ 🔁 🔄 ✕ ✎ 🗑️ ▶ 📜 ⟳); replace the header div with a real <h1>; add role=dialog + aria-modal + focus trap + restore-focus to the modal flow. (impact: high, effort: medium)
2. [security] Default the HU Board to bind 127.0.0.1 (require explicit HU_BOARD_HOST=0.0.0.0 to expose); add path-resolve containment check in /api/runs/:commandId/log and /api/plans/:planId/log; switch token auth comparison to crypto.timingSafeEqual. (impact: high, effort: low)
3. [codeQuality] Split packages/hu-board/public/app.js (3428 lines) into per-view modules (board/dashboard/graph/sessions/modals) and move inline styles into styles.css; replace inline onclick handlers with addEventListener delegation. (impact: high, effort: high)
4. [testing] Lift branch coverage from 69% to 80% by targeting uncovered branches in src/sonar/* (8 files, 0 same-name tests) and src/cli/register-*.js; add e2e smoke for the SPDD planner emit (memory mentions repeated bugs in this area). (impact: medium, effort: medium)
5. [architecture] Add `madge --circular src` to npm validate (or CI); standardise pipeline state on a single typed PipelineContext object passed by reference through every driver; add an architecture test for packages/hu-board. (impact: medium, effort: low)
6. [codeQuality] Decide on @changesets/cli (PR #360): land or drop. Either way, document config-file map (kj.config.yml, sonar-project.properties, .kj-ready.json, …) in ARCHITECTURE.md. (impact: low, effort: low)

---
Karajan Code v2.8.0 is in good overall health. npm audit reports zero vulnerable dependencies, the recent v2.7.4 'drivers/' refactor split the orchestrator into single-concern modules, and the test ratio (1.12 test files per source file, 78.6% line coverage) is solid. Two areas need attention: (1) the HU Board UI (packages/hu-board) has high-impact accessibility debt — missing aria-labels on every icon-only button, no <h1> on the index page, no focus management in modals, several form controls without labels — and a 3428-line god-module in public/app.js; (2) the board's HTTP surface defaults to binding all interfaces with auth opt-in and lacks path-containment hardening on the log-tail endpoints. Branch coverage (69%) and a stale @changesets/cli dep are the only quality friction. Top priority: accessibility pass on the board + tighten board defaults to 127.0.0.1 with timing-safe auth.
