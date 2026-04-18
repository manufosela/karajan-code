/**
 * Global Vitest setup. Applied to every test file via vitest.config.js
 * `setupFiles`.
 *
 * Two effects:
 *
 * 1) Preload API-key env vars so the token checks in the extended preflight
 *    don't fail for providers that orchestrator tests happen to reference
 *    (claude, codex, gemini…) without caring about real credentials.
 *    Individual tests that want to assert missing-key behavior can
 *    `delete process.env.XXX` in their own setup.
 *
 * 2) Default the extended preflight to OFF under Vitest. Orchestrator tests
 *    don't mock the new IO surfaces (port-check, fs.stat, spawn, openskills
 *    CLI) so running extended preflight against a real machine causes flaky
 *    failures. Tests that explicitly exercise the extended preflight set
 *    `config.preflight.extended: true` or override the global.
 */

process.env.ANTHROPIC_API_KEY ??= "sk-test-anthropic";
process.env.OPENAI_API_KEY ??= "sk-test-openai";
process.env.GEMINI_API_KEY ??= "sk-test-gemini";
process.env.GOOGLE_API_KEY ??= "sk-test-google";
process.env.OPENCODE_API_KEY ??= "sk-test-opencode";

globalThis.__KJ_DEFAULT_PREFLIGHT_EXTENDED = false;
