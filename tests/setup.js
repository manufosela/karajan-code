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

import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "../src/utils/paths.js";

process.env.ANTHROPIC_API_KEY ??= "sk-test-anthropic";
process.env.OPENAI_API_KEY ??= "sk-test-openai";
process.env.GEMINI_API_KEY ??= "sk-test-gemini";
process.env.GOOGLE_API_KEY ??= "sk-test-google";
process.env.OPENCODE_API_KEY ??= "sk-test-opencode";
// KJC-BUG-0083: the preflight now runs the real Sonar project-key resolver.
// Suites that mock runCommand generically would feed it garbage as the git
// remote, so give every test an explicit key. Tests that exercise the
// derivability check itself delete this var in their own setup.
process.env.KJ_SONAR_PROJECT_KEY ??= "kj-test-suite";

// loadConfig refuses local config without a global counterpart (KJC-TSK-0395).
// Under Vitest, KARAJAN_HOME is auto-isolated to a tmp dir per worker but the
// cwd is still the karajan-code repo, which ships a real `.karajan/kj.config.yml`.
// Pre-seed an empty global config so loadConfig is happy in tests that exercise
// it (i18n.test.js, board.test.js, sea-build.test.js).
const _home = getKarajanHome();
fs.mkdirSync(_home, { recursive: true });
const _globalCfg = path.join(_home, "kj.config.yml");
if (!fs.existsSync(_globalCfg)) {
  fs.writeFileSync(_globalCfg, "");
}

globalThis.__KJ_DEFAULT_PREFLIGHT_EXTENDED = false;

// Default skills mode to "regex" under Vitest so orchestrator tests that do
// not mock the semantic detector don't spawn classifier agents and skew
// agent-invocation assertions. Tests that exercise the semantic path set
// `flags.skillsMode = "auto"` or `config.skills.mode = "semantic"` explicitly.
globalThis.__KJ_DEFAULT_SKILLS_MODE = "regex";

// Default the Brain decisor OFF under Vitest. Many orchestrator tests assert
// exact pipeline flag state after triage; the Brain routing may legitimately
// override those flags per its decision logic. Tests that exercise Brain
// routing opt in via `config.brain.decisor.enabled = true` explicitly.
globalThis.__KJ_DEFAULT_BRAIN_DECISOR = false;

// Default the addyosmani/agent-skills catalog OFF under Vitest. Many
// orchestrator tests assert exact event/command sequences; the catalog step
// would add a git probe + skills:addyosmani-ready event that they don't
// expect. Tests that exercise the catalog opt in via
// `config.skills.addyosmani.enabled = true` explicitly (or rely on the direct
// unit tests in tests/skills/addyosmani-*.test.js which mock git themselves).
globalThis.__KJ_DEFAULT_ADDYOSMANI_ENABLED = false;

// Disable the Sonar stage under Vitest. Sonar is intrinsic to Karajan in
// production for code tasks (sw/refactor/add-tests) and the production
// preflight auto-starts the Docker container. Forcing every test that touches
// the flow runner to bring up SonarQube would be both slow (20-40 s warmup)
// and brittle (requires Docker on the runner). Tests that specifically
// exercise the sonar stage opt in by setting __KJ_DISABLE_SONAR_STAGE = false
// in their own setup, or mock runSonarStage directly.
globalThis.__KJ_DISABLE_SONAR_STAGE = true;
