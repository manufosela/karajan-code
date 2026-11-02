/**
 * A plugin's user_config values (step 13, P8 B1). First set wins: the environment
 * `ATRIL_PLUGIN_<NAME>_<KEY>`, the per-user file `<config home>/atril/plugins/<plugin>.json`
 * (0600, outside the repo), then `pluginConfig.<plugin>.<key>` in the committed atril.json.
 * A `sensitive` value is written ONLY to the per-user file: never to atril.json, the lock or the store.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { CONFIG_KEY, readConfig, writeConfig } from "./config.js";
import { isMapping } from "./model.js";
import { readJson, readPluginManifest, SAFE_NAME } from "./plugin.js";

/** The keys a plugin declares: `[{ key, title, description, sensitive }]`. */
export function declaredPluginConfig(dir) {
  const { userConfig } = readPluginManifest(dir).manifest;
  if (userConfig === undefined) return [];
  if (!isMapping(userConfig)) throw new Error(`${dir}: userConfig must be an object keyed by option name`);
  return Object.entries(userConfig).map(([key, option]) => {
    if (!CONFIG_KEY.test(key)) throw new Error(`${dir}: userConfig key "${key}" is not an identifier (letters, digits, underscores)`);
    if (!isMapping(option)) throw new Error(`${dir}: userConfig.${key} must be an object`);
    return { key, title: option.title, description: option.description, sensitive: option.sensitive === true };
  });
}

const check = (plugin, key) => {
  if (!SAFE_NAME.test(plugin)) throw new Error(`"${plugin}" is not a plugin name (lowercase letters, digits and dashes)`);
  if (key !== undefined && !CONFIG_KEY.test(key)) throw new Error(`"${key}" is not a config key (letters, digits, underscores)`);
};

const userFile = (plugin, { env = process.env, home = homedir() } = {}) =>
  join(env.XDG_CONFIG_HOME || join(home, ".config"), "atril", "plugins", `${plugin}.json`);

const envName = (plugin) => `ATRIL_PLUGIN_${plugin.replace(/-/g, "_").toUpperCase()}_`;

function readUserFile(plugin, opts) {
  const path = userFile(plugin, opts);
  if (!existsSync(path)) return {};
  const values = readJson(path);
  if (!isMapping(values)) throw new Error(`${path}: must be a JSON object`);
  return values;
}

/**
 * Every value set for a plugin, secrets included: for substituting and exporting, never for listing.
 * An environment variable is upper case, so it is looked up per key: `opts.keys` are the declared ones.
 */
export function readPluginConfig(plugin, opts = {}) {
  check(plugin);
  const { env = process.env, keys = [] } = opts;
  const values = { ...readConfig(opts).pluginConfig?.[plugin], ...readUserFile(plugin, opts) };
  for (const key of new Set([...keys, ...Object.keys(values)])) {
    const fromEnv = env[`${envName(plugin)}${key.toUpperCase()}`];
    if (fromEnv !== undefined) values[key] = fromEnv;
  }
  return values;
}

/** `opts.sensitive` is required: the caller got it from the manifest, and a guess could leak a secret. */
export function writePluginConfig(plugin, key, value, opts = {}) {
  check(plugin, key);
  if (typeof opts.sensitive !== "boolean") throw new Error(`writePluginConfig needs opts.sensitive (true or false) for ${plugin}.${key}`);
  if (!opts.sensitive) {
    const config = readConfig(opts);
    writeConfig({ ...config, pluginConfig: { ...config.pluginConfig, [plugin]: { ...config.pluginConfig?.[plugin], [key]: value } } }, opts);
    return;
  }
  const { platform = process.platform } = opts;
  if (platform === "win32") throw new Error(`${plugin}.${key} is sensitive and cannot be stored on win32: no per-user file with restricted permissions`);
  if (typeof value !== "string") throw new Error(`${plugin}.${key} is sensitive: its value must be a string`);
  const path = userFile(plugin, opts);
  const values = { ...readUserFile(plugin, opts), [key]: value };
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeAtomic(path, `${JSON.stringify(values, null, 2)}\n`, 0o600);
}
