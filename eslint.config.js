/**
 * ESLint flat config — minimal "stop the bleeding" baseline.
 *
 * The whole point of this config is to catch the bug class that took
 * the demo down on 2026-04-27: `iteration-loop.js` called
 * `saveSession(session)` without importing it. JS happily lets that
 * through; the orchestrator threw `ReferenceError: saveSession is not
 * defined` only when the specific reviewer-rejection code path ran
 * end-to-end. None of the 4070 unit tests caught it because each one
 * mocked the reviewer with a shape that didn't reach that line.
 *
 * Three rules close that family completely (and run in <2 s):
 *   - `no-undef`               — symbol used but never declared/imported.
 *   - `import-x/no-unresolved` — import path doesn't resolve to anything.
 *   - `import-x/named`         — named import doesn't exist in the target
 *                                 module (so `import { saveSesion } from
 *                                 ".../store.js"` — typo — would fail).
 *
 * Anything beyond those is `warn` for now (formatting, unused vars).
 * We can ratchet later; first land the no-error baseline.
 *
 * 2026-04-27 follow-up (audit recommendation #2): tests/ now covered
 * too. The same three "bug-killer" rules apply — `no-undef`,
 * `import-x/no-unresolved`, `import-x/named` — with a vitest globals
 * block and a relaxed `no-unused-vars` (test fixtures often declare
 * symbols for assertion-only purposes).
 *
 * 2026-04-27 follow-up (audit recommendation #3): bans
 * `globalThis.__KJ_*` everywhere in src/ except the one file that
 * legitimately reads them (`src/config/test-harness.js`). Pre-v2.7.5
 * those globals were scattered across orchestrator code, which made
 * test setup brittle and the runtime config un-typed. They're now
 * read once, inside `test-harness.js`, and the rest of src/ talks
 * to typed config getters. The selector below stops anyone (LLM or
 * human) re-introducing the old pattern.
 *
 * 2026-04-27 follow-up (audit recommendation #5): bans `console.*` in
 * library / orchestrator code. Audit-time review of 309 console.* call
 * sites confirmed every existing one is justified — they sit in CLI
 * commands (`src/commands/`), display utilities (`src/utils/display/`,
 * `banner.js`, `welcome.js`), the structured logger implementation
 * itself (`src/utils/logger.js`), or the three orchestrator drivers
 * that print user-facing run banners (`init-context.js`, `pre-loop.js`,
 * `post-loop.js`). The rule below switches `no-console` from
 * "off everywhere" to "error everywhere except those known-good
 * paths" so future code can't slip a `console.log` into the library
 * layer. New CLI commands inherit the allow list automatically because
 * they live under `src/commands/**`.
 */

import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import nodeSecurity from "eslint-plugin-node-security";
import security from "eslint-plugin-security";
import globals from "globals";

export default [
  // packages/radar llegó del monorepo familiar (MONO-1, KJC-TSK-0738) con su
  // propio toolchain (frontend TS/React + backend Python): lo linta su
  // tooling, no este config JS — sin ignore, `eslint packages/` revienta
  // contra su TS y el pre-commit bloquea cualquier commit del repo.
  { ignores: ["packages/radar/**"] },
  // ESLint's own recommended set — already enables `no-undef`,
  // `no-unused-vars`, `no-redeclare`, etc. with sensible defaults.
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        // The codebase touches a few browser-y globals through
        // `process.env`-style bridging; declare them so eslint
        // doesn't flag them when used.
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    plugins: {
      "node-security": nodeSecurity,
      "import-x": importX,
      security,
    },
    rules: {
      // --- Hard fail (the bug-killers) -------------------------------
      "no-undef": "error",
      "import-x/no-unresolved": [
        "error",
        {
          // Node built-ins like "node:fs" are fine even though no JS
          // file lives behind them.
          ignore: ["^node:"],
        },
      ],
      "import-x/named": "error",

      // --- Unsafe code policy (KJC-TSK-0468) -------------------------
      // High-signal rules from eslint-plugin-security. The "noisy"
      // members of the recommended preset (`detect-object-injection`,
      // `detect-non-literal-fs-filename`, `detect-child-process`) are
      // intentionally NOT enabled — they flag a huge percentage of
      // legitimate orchestrator code (fs ops on user paths, execa
      // calls). The rules below catch concrete dynamic-code-execution
      // and crypto smells without false-positive churn.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-non-literal-regexp": "warn",

      // `detect-possible-timing-attacks` is one of the noisy members left out
      // above — it matches on variable NAMES, so every `if (user.token === …)`
      // in a test fixture reports. This rule asks the same question
      // structurally: a comparison operator applied to a value that reaches a
      // credential, which is why the whole repository passes it today and did
      // not before `packages/hu-board/src/auth.js` was fixed in this PR.
      "node-security/no-timing-unsafe-compare": "error",

      // --- Soft signals (warn, not error) ----------------------------
      // Audit rec #8: ratchet from "warn" to "error" after the
      // 2026-04-30 cleanup pass that closed 57 warnings across 30
      // files. With src/ at 0 warnings, the next no-unused-vars
      // regression should fail CI, not silently accumulate.
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // Same ratchet rationale: these were warnings while the cleanup
      // backlog existed; the same PR closed them all, so they're now
      // hard errors. A regression is louder than a "warn".
      "no-useless-assignment": "error",
      "no-useless-escape": "error",
      "preserve-caught-error": "error",

      // Audit rec #5: ban console.* in src/ by default. The override
      // block below re-enables it for the known-good CLI / display /
      // logger paths.
      "no-console": "error",
      // Some files conditionally `let x; if (...) x = ...;`; legitimate.
      "prefer-const": "off",
      // ANSI escape parsing in run-log viewers legitimately uses \x1b
      // inside RegExp; disabling globally is fine because the codebase
      // doesn't accept untrusted regex from users.
      "no-control-regex": "off",

      // Audit rec #3: ban globalThis.__KJ_* outside test-harness.js.
      // The selector matches both reads (`globalThis.__KJ_FOO`) and
      // writes (`globalThis.__KJ_FOO = ...`), which is what we want —
      // production code shouldn't touch these at all.
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='globalThis'][property.name=/^__KJ_/]",
          message:
            "globalThis.__KJ_* is a test-only override surface. " +
            "Read/write it only from src/config/test-harness.js, then expose " +
            "the value through a typed config getter that the rest of src/ uses.",
        },
      ],
    },
  },
  {
    // The single file allowed to read/write globalThis.__KJ_*.
    // (The override is *only* for `no-restricted-syntax`; everything
    // else still applies.)
    files: ["src/config/test-harness.js"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // Audit rec #5: paths where `console.*` is the intended UX surface,
    // not a forgotten debug print. Everything else under src/ falls
    // back to the default "no-console: error" set above.
    files: [
      "src/cli.js",
      "src/cli/**/*.js",
      "src/commands/**/*.js",
      "src/utils/banner.js",
      "src/utils/welcome.js",
      "src/utils/update-check.js",
      "src/utils/display/**/*.js",
      "src/utils/logger.js",
      // Shared CLI prompt helper used by run.js + resume.js (KJC-BUG-0081
      // round 2). Same UX surface as src/commands/**/*.js — was inlined
      // there until the duplicate copy in resume.js shipped without the
      // --yes guard. Lives in utils/ now for DRY, keeps the same allow.
      "src/utils/cli-ask-question.js",
      // The orchestrator drivers below print user-facing run banners
      // (board URL, plan summary). They're terminal output, not log
      // lines that would benefit from a structured logger.
      "src/orchestrator/drivers/init-context.js",
      "src/orchestrator/drivers/pre-loop.js",
      "src/orchestrator/drivers/post-loop.js",
      // Pre-loop phases (sub-modules of pre-loop.js): when a phase
      // auto-starts the HU board it prints the same banner the parent
      // driver does. Allow console.* in the whole sub-package for
      // architectural consistency with pre-loop.js itself.
      "src/orchestrator/drivers/pre-loop-phases/**/*.js",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Scripts block — build/release utilities run under Node directly
    // (no bundler). Node globals + console allowed; unused-vars soft
    // (destructuring-rest to drop a key leaves a named binding).
    files: ["scripts/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": "warn",
    },
  },
  {
    // Tests block — same bug-killer rules, plus vitest globals and
    // relaxed unused-vars (helpers + fixtures legitimately allocate
    // bindings whose value is only their existence).
    files: ["tests/**/*.js", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        // Vitest is import-based (no `globalThis.describe`), but tests
        // also drive Playwright fixtures and DOM assertions in a few
        // places. The browser globals cover those without polluting src.
      },
    },
    plugins: {
      "import-x": importX,
    },
    rules: {
      // --- Hard fail (the bug-killers) -------------------------------
      "no-undef": "error",
      "import-x/no-unresolved": [
        "error",
        {
          ignore: ["^node:"],
        },
      ],
      "import-x/named": "error",

      // --- Soft signals (warn, not error) ----------------------------
      // Tests routinely declare unused fixture vars for documentation
      // ("the response shape used to look like X"). Keep as warn so
      // we still see them, but don't block CI.
      "no-unused-vars": "warn",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",

      // --- Off (intentional in tests) --------------------------------
      "no-console": "off",
      "prefer-const": "off",
      "no-control-regex": "off",
      // Tests legitimately use `var` in some setup blocks where binding
      // hoisting is the cleanest expression of intent. Don't fight it.
      "no-var": "off",
    },
  },

  // KJC-TSK-0543 — packages/ joins the lint surface. It rotted to 1100+
  // errors precisely because `npm run lint` never looked at it; same
  // bug-killer rules as src/, three environments, and the lint script now
  // covers it so the regression is structurally impossible.
  {
    files: [
      "packages/*/src/**/*.js",
      "packages/*/bin/**/*.js",
      "packages/*/*.js",
      "packages/*/scripts/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node, fetch: "readonly", URL: "readonly", URLSearchParams: "readonly" },
    },
    plugins: { "import-x": importX },
    rules: {
      "no-undef": "error",
      "import-x/no-unresolved": ["error", { ignore: ["^node:"] }],
      "import-x/named": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-useless-assignment": "error",
      "no-useless-escape": "error",
      "preserve-caught-error": "error",
    },
  },
  {
    // The hu-board dashboard is BROWSER code in CLASSIC scripts: index.html
    // loads 21 <script> tags and the files share one deliberate global API
    // (function declarations hoist to global scope; inline onclick handlers
    // call them). `no-undef` stays a bug-killer here because every shared
    // symbol is declared below. Regenerate the list after adding a
    // top-level function/var to public/:
    //   grep -hoE '^(async +)?function [A-Za-z_$][\w$]*|^(let|var|const) [A-Za-z_$][\w$]*' packages/hu-board/public -r
    files: ["packages/hu-board/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...Object.fromEntries(
          `ANSI_SGR DAG_H_GAP DAG_NODE_H DAG_NODE_W DAG_PAD DAG_V_GAP EPHEMERAL_HEURISTIC_RE ESC ESC_CHARS HEADERS
           HTML_ESC KNOWN_ROLES POLL_INTERVAL_MS SCOPED_PREFIX TOKEN __versionBaseline _fmtCountdown _renderStandbyBanner
           _standbyData _standbyPollTimer _standbyTickTimer _tickStandbyCountdowns activePromptId ansi256ToCss ansiToHtml
           api bars bytes closeModal closePromptModalIfMatches computeDagLevels computeEffectiveResult
           confirmRunWithPreflight cssEscape currentSessionId currentView deriveInitialsFromName deriveRoleStatus els
           embedderCard ensureDialog esc escapeHtml fetchPreflight formatCacheRatio formatCost formatDuration formatHHMM
           formatProjectCostSummary formatSessionLabel handleRoute humaniseProjectName isTestIcon isTestTitle
           isMaggleMode lastLaunchedPlanId lastOpenedLog load loadSessions logPollTimer logViewerState maggleText
           applyMaggleChrome maggleErrorParts MAGGLE_LABELS MAGGLE_STORE_KEY navigate nextIsTestValue
           openCommandLogViewer openGenericLogPanel openLogViewer patchBoardIncremental pollServerVersion pollTimer
           populateProjectSelect preflightCache preflightStatusColor preflightStatusIcon projectInitialsCache
           projectIsSharedCache projectNameCache qualityBar refreshCurrentView refreshInterval refreshOnce refreshStandby
           render renderBoard renderDashboard renderEmptyState renderGovernance renderGraph renderHits renderInstallCTA renderIterations
           renderKanbanColumn renderOutcomeChip renderPlanRollup renderPreflightPanel renderProjectPicker
           renderResultBadge renderRoleGrid renderSessionCard renderSessions renderSolomon renderStoryCard
           renderStoryEditForm renderSummary resolveBlockedBy resolveProjectInitials resolveProjectMeta runProject
           runSearch saveStoryEdits scopedProjectSlug scoreClass selectProject selectedProject shortStoryId shortTask
           showCommandLauncher showConfigEditor showConfirm showError showHelp showPromptModal showSessionDetail
           showStoryDetail smartRefresh sseRefreshTimer sseSource startPolling startStandbyPolling stopPolling
           subscribeToServerEvents timeAgo triggerSync truncate winBtnStyle`
            .split(/\s+/)
            .filter(Boolean)
            .map((name) => [name, "writable"])
        ),
      },
    },
    rules: {
      "no-undef": "error",
      // Defining one of the declared shared globals in its home file is the
      // POINT of a classic script, not a redeclaration bug.
      "no-redeclare": ["error", { builtinGlobals: false }],
      // Cross-file usage (other scripts, inline onclick) is invisible to a
      // per-file linter — warn keeps real dead code visible without lying.
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // The console page is BROWSER code as an ES module (no build): browser globals only.
    files: ["packages/console/ui/**/*.js"],
    languageOptions: { ecmaVersion: 2025, sourceType: "module", globals: { ...globals.browser } },
    rules: { "no-undef": "error", "no-console": "error" },
  },
  {
    files: ["packages/*/tests/**/*.js", "packages/*/tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { "import-x": importX },
    rules: {
      "no-undef": "error",
      "import-x/no-unresolved": ["error", { ignore: ["^node:"] }],
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
];
