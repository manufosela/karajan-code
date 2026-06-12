/**
 * Config I/O layer — reads and writes Karajan's YAML config files.
 *
 * Extracted from `src/config.js` in TSK-0332 (Oleada 2 of the v2.7.4 audit
 * refactor). The public API (`loadConfig`, `writeConfig`, `getConfigPath`,
 * `getProjectConfigPath`, `loadProjectConfig`) stayed exactly the same so
 * the 28+ files that imported from `src/config.js` didn't have to change.
 *
 * Responsibilities:
 *   - Resolve the global config path under `~/.karajan/kj.config.yml`
 *     (respecting `KJ_HOME`).
 *   - Resolve the project config path under `<projectDir>/.karajan/kj.config.yml`.
 *   - Load + merge global over DEFAULTS, then project over merged.
 *   - Validate the merged config via the Valibot schema.
 *   - Record deprecation flags (e.g. `sonarqube.enabled` → ignored since v2.7.4)
 *     for the orchestrator to surface as warnings at run start.
 *
 * Intentionally NOT here: flag overrides (src/config/overrides.js),
 * role resolution (src/config/role-resolver.js), DEFAULTS (src/config/defaults.js).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ensureDir, exists } from "../utils/fs.js";
import { getKarajanHome } from "../utils/paths.js";
import { safeParseConfig, formatConfigIssues } from "./schema.js";
import { DEFAULTS } from "./defaults.js";
import { resolveTestHarness } from "./test-harness.js";

/**
 * Parse a YAML config file with an actionable error message.
 * Plain `yaml.load` throws `YAMLException: bad indentation ...` with NO
 * file path, so a single bad edit bricked the entire CLI (including
 * `kj doctor`, the one command meant to diagnose it). Wrapping every
 * read site in the same prefix means the user always knows which file
 * they need to fix.
 * @param {string} raw - file contents
 * @param {string} filePath - absolute path (for the error message)
 * @returns {object}
 */
function parseYamlOrThrow(raw, filePath) {
  try {
    return yaml.load(raw, { json: true }) || {};
  } catch (err) {
    const detail = err?.message || String(err);
    const e = new Error(`Invalid YAML in ${filePath}:\n  ${detail}`);
    e.cause = err;
    e.code = "INVALID_YAML";
    e.path = filePath;
    throw e;
  }
}

export function mergeDeep(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (value && typeof value === "object") {
      output[key] = mergeDeep(base[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function getConfigPath() {
  return path.join(getKarajanHome(), "kj.config.yml");
}

export function getProjectConfigPath(projectDir = process.cwd()) {
  return path.join(projectDir, ".karajan", "kj.config.yml");
}

export async function loadProjectConfig(projectDir = process.cwd()) {
  const projectConfigPath = getProjectConfigPath(projectDir);
  if (!(await exists(projectConfigPath))) {
    return null;
  }
  const raw = await fs.readFile(projectConfigPath, "utf8");
  return parseYamlOrThrow(raw, projectConfigPath);
}

async function loadProjectPricingOverrides(projectDir = process.cwd()) {
  const projectConfigPath = path.join(projectDir, ".karajan.yml");
  if (!(await exists(projectConfigPath))) {
    return null;
  }

  const raw = await fs.readFile(projectConfigPath, "utf8");
  const parsed = parseYamlOrThrow(raw, projectConfigPath);
  const pricing = parsed?.budget?.pricing;
  if (!pricing || typeof pricing !== "object") {
    return null;
  }

  return pricing;
}

export async function loadConfig(projectDir) {
  const configPath = getConfigPath();
  const projectPricing = await loadProjectPricingOverrides(projectDir);

  // Load global config
  let globalConfig = {};
  const globalExists = await exists(configPath);
  if (globalExists) {
    const raw = await fs.readFile(configPath, "utf8");
    globalConfig = parseYamlOrThrow(raw, configPath);
  }

  // Load project config (.karajan/kj.config.yml)
  const projectConfig = await loadProjectConfig(projectDir);

  // KJC-TSK-0395: enforce the local-overrides-global hierarchy. A project
  // config with no global counterpart is almost always user error (copied
  // a .karajan dir from another repo, edited the wrong file, etc.) and
  // would silently behave like a global config without the defaults
  // people expect. Refuse with an actionable message.
  if (projectConfig && !globalExists) {
    throw new Error(
      `Local config found at ${getProjectConfigPath(projectDir)} but no global config exists.\n` +
      "Local configs are merged ON TOP of the global one — run `kj init --global` first to create the base."
    );
  }

  // Merge: DEFAULTS < global < project
  let merged = mergeDeep(DEFAULTS, globalConfig);
  if (projectConfig) {
    merged = mergeDeep(merged, projectConfig);
  }

  if (projectPricing) {
    merged.budget = mergeDeep(merged.budget || {}, { pricing: projectPricing });
  }

  // KJC-TSK-0318 — schema-validate the merged config so invalid values
  // (review_mode typos, max_iterations=0, out-of-range ports) surface at
  // load time with a clear error instead of crashing deep inside the
  // orchestrator. safeParse + explicit error prefix keeps the message
  // actionable.
  const validation = safeParseConfig(merged);
  if (!validation.success) {
    throw new Error(`Invalid Karajan config:\n${formatConfigIssues(validation.issues)}`);
  }

  // Deprecation tracking — `sonarqube.enabled` was a footgun: users would
  // set it to `false` in their global ~/.karajan/kj.config.yml and then
  // wonder why Sonar didn't run on a code task. Since v2.7.4 Sonar is
  // intrinsic to Karajan for code tasks; the field is ignored. We surface
  // a warning at run start (see emitConfigDeprecations in flow-runner.js)
  // so users notice and clean up their config. Don't throw — keep
  // back-compat so existing scripts keep working.
  const userSetSonarEnabled = (globalConfig?.sonarqube?.enabled !== undefined)
    || (projectConfig?.sonarqube?.enabled !== undefined);
  if (userSetSonarEnabled) {
    merged._deprecated = merged._deprecated || {};
    merged._deprecated.sonarqubeEnabledKey = true;
  }

  merged.testHarness = resolveTestHarness(merged.testHarness);
  return { config: merged, path: configPath, exists: globalExists, hasProjectConfig: !!projectConfig };
}

/**
 * Runtime-only keys that the loader synthesises on every load (or that
 * a wizard uses as transient in-memory hints). They MUST NOT survive
 * to the on-disk YAML — otherwise the `kj run` deprecation warning
 * fossilises (KJC-BUG-0036, observed in dogfooding 2026-05-07: the
 * `_deprecated.sonarqubeEnabledKey: true` block ended up baked into
 * `~/.karajan/kj.config.yml` and re-fired the warning on every run
 * even after the user cleaned `sonarqube.enabled`).
 *
 * Pure: returns a shallow-copied config without the runtime keys —
 * the caller's object is left untouched.
 */
function stripRuntimeOnlyKeys(config) {
  if (!config || typeof config !== "object") return config;
  const out = { ...config };
  // _deprecated is loader-synthesised — never written intentionally.
  if ("_deprecated" in out) delete out._deprecated;
  // sonarqube.enabled was deprecated in v2.7.4. The init wizard still
  // uses it as a hint to drive setupSonarQube during install, but the
  // runtime ignores it. Persisting it would re-trigger the deprecation
  // warning on every subsequent kj run.
  if (out.sonarqube && typeof out.sonarqube === "object"
      && Object.prototype.hasOwnProperty.call(out.sonarqube, "enabled")) {
    const rest = { ...out.sonarqube };
    delete rest.enabled;
    out.sonarqube = rest;
  }
  return out;
}

export async function writeConfig(configPath, config) {
  await ensureDir(path.dirname(configPath));
  const sanitized = stripRuntimeOnlyKeys(config);
  await fs.writeFile(configPath, yaml.dump(sanitized, { lineWidth: 120 }), "utf8");
}

// Declarative mappings for applyRunOverrides to reduce cognitive complexity.

