/**
 * Karajan config barrel — public re-exports for back-compat.
 *
 * Pre-v2.7.5 this file was 636 LOC with fan-in 28: it bundled DEFAULTS
 * data, loadConfig/writeConfig I/O, applyRunOverrides merge logic,
 * resolveRole lookup and validateConfig schema gate — touching any of
 * those risked rippling to a quarter of the codebase. TSK-0332 (Oleada 2
 * of the audit refactor) split along the natural seams:
 *
 *   - `src/config/defaults.js`        — pure data, DEFAULTS
 *   - `src/config/loader.js`          — fs/yaml I/O (getConfigPath,
 *                                       loadConfig, writeConfig, etc.)
 *   - `src/config/overrides.js`       — CLI-flag merge (applyRunOverrides)
 *   - `src/config/role-resolver.js`   — provider/model/validate
 *   - `src/config/schema.js`          — Valibot schema (pre-existing)
 *
 * This file is now a thin barrel so the 28+ consumers importing from
 * `src/config.js` keep working unchanged. New code should import from
 * the specific submodule.
 *
 * @typedef {import("./config/schema.js").KarajanConfig} KarajanConfig
 */

export { DEFAULTS } from "./config/defaults.js";
export {
  getConfigPath,
  getProjectConfigPath,
  loadProjectConfig,
  loadConfig,
  writeConfig,
} from "./config/loader.js";
export { applyRunOverrides } from "./config/overrides.js";
export { resolveRole, validateConfig } from "./config/role-resolver.js";
export { safeParseConfig, formatConfigIssues } from "./config/schema.js";
