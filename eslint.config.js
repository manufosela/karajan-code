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
 * Tests directory is intentionally excluded from this first pass —
 * vitest's `vi.mock()`, dynamic `await import("...")` patterns, and
 * heavy global injection make an over-strict config noisy without
 * payoff. Once the src baseline is green and stable, extend coverage.
 */

import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import globals from "globals";

export default [
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
      "import-x": importX,
    },
    rules: {
      // --- Hard fail (the bug-killers) -------------------------------
      "no-undef": "error",
      "import-x/no-unresolved": ["error", {
        // Node built-ins like "node:fs" are fine even though no JS
        // file lives behind them.
        ignore: ["^node:"],
      }],
      "import-x/named": "error",

      // --- Soft signals (warn, not error) ----------------------------
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
      // Cosmetic / quality-of-code rules: kept as warnings so FASE 0
      // can land green today. Each is a real signal worth fixing later
      // (track in follow-up PR), but none block bug-detection.
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
      "preserve-caught-error": "warn",

      // --- Off (intentional) -----------------------------------------
      // The codebase uses `console.log` deliberately in CLI output paths.
      "no-console": "off",
      // Some files conditionally `let x; if (...) x = ...;`; legitimate.
      "prefer-const": "off",
      // ANSI escape parsing in run-log viewers legitimately uses \x1b
      // inside RegExp; disabling globally is fine because the codebase
      // doesn't accept untrusted regex from users.
      "no-control-regex": "off",
    },
  },
];
