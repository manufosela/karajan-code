/**
 * Test-harness-visible config knobs — resolved once per run, then read
 * everywhere via `config.testHarness.*`.
 *
 * Pre-v2.7.5 these defaults were read from `globalThis.__KJ_*` directly
 * in production code paths — `flow-runner.js` read
 * `globalThis.__KJ_DEFAULT_BRAIN_DECISOR`, `preflight-checks.js` read
 * `globalThis.__KJ_DISABLE_SONAR_STAGE`, etc. The audit flagged this as
 * spooky-action-at-a-distance: a stray test-harness leftover could flip
 * a production default, and tests did not exercise the same path
 * production users would.
 *
 * TSK-0334 isolates the globalThis lookup to a single site (this module,
 * run during config load) and exposes the resolved knobs under
 * `config.testHarness`. Production code reads only from `config.*`,
 * never from `globalThis`. Tests can set either `globalThis.__KJ_*`
 * (back-compat for the ~10 existing test files that already do) or pass
 * `config.testHarness = { ... }` explicitly.
 *
 * The `tests/architecture/no-globalThis-kj.test.js` invariant fails CI
 * if a `globalThis.__KJ_` read reappears anywhere under `src/` outside
 * this module.
 *
 * Resolution order (first defined wins):
 *   1. `config.testHarness.<key>` (explicit test or user config)
 *   2. `globalThis.__KJ_<MACRO>`  (existing test-harness global, back-compat)
 *   3. Documented default (second column below)
 *
 * | config.testHarness key         | globalThis key                  | prod default |
 * |--------------------------------|----------------------------------|--------------|
 * | disableSonarStage              | __KJ_DISABLE_SONAR_STAGE        | false        |
 * | defaultSkillsMode              | __KJ_DEFAULT_SKILLS_MODE        | "auto"       |
 * | defaultPreflightExtended       | __KJ_DEFAULT_PREFLIGHT_EXTENDED | true         |
 * | defaultBrainDecisor            | __KJ_DEFAULT_BRAIN_DECISOR      | true         |
 * | defaultAddyosmaniEnabled       | __KJ_DEFAULT_ADDYOSMANI_ENABLED | true         |
 */

const GLOBAL_KEYS = {
  disableSonarStage:        "__KJ_DISABLE_SONAR_STAGE",
  defaultSkillsMode:        "__KJ_DEFAULT_SKILLS_MODE",
  defaultPreflightExtended: "__KJ_DEFAULT_PREFLIGHT_EXTENDED",
  defaultBrainDecisor:      "__KJ_DEFAULT_BRAIN_DECISOR",
  defaultAddyosmaniEnabled: "__KJ_DEFAULT_ADDYOSMANI_ENABLED",
};

const PROD_DEFAULTS = Object.freeze({
  disableSonarStage:        false,
  defaultSkillsMode:        "auto",
  defaultPreflightExtended: true,
  defaultBrainDecisor:      true,
  defaultAddyosmaniEnabled: true,
});

/**
 * Resolve the testHarness slice of config. Safe to call multiple times;
 * each call re-reads globalThis so test-harness overrides applied after
 * config load still take effect on the next resolution.
 *
 * @param {Partial<typeof PROD_DEFAULTS>} [explicit] - typically `config.testHarness` passed in
 * @returns {Readonly<typeof PROD_DEFAULTS>}
 */
export function resolveTestHarness(explicit = {}) {
  const out = {};
  for (const [key, globalName] of Object.entries(GLOBAL_KEYS)) {
    if (explicit && Object.prototype.hasOwnProperty.call(explicit, key) && explicit[key] !== undefined) {
      out[key] = explicit[key];
      continue;
    }
    const g = globalThis[globalName];
    if (g !== undefined) {
      out[key] = g;
      continue;
    }
    out[key] = PROD_DEFAULTS[key];
  }
  return Object.freeze(out);
}

