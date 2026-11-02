/**
 * The store's config (ADR 0021, decisions 10-12): `<root>/atril.json` holds
 * the target CLIs, the artifacts exposed permanently per kind, the catalogs
 * and the rulesync opt-in. An absent file is DEFAULT_CONFIG; a bad field
 * fails loudly, naming it. Writes are atomic and deterministic.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeAtomic } from "./atomic.js";
import { isMapping, KINDS, SLUG, sortKeys } from "./model.js";
import { SAFE_NAME } from "./plugin.js";
import { resolveRoot } from "./scan.js";

// Frozen all the way down, so a consumer cannot corrupt the default for the next absent file.
const deepFreeze = (value) => {
  for (const inner of Object.values(value)) if (typeof inner === "object" && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const DEFAULT_CONFIG = deepFreeze({
  targets: [],
  expose: Object.fromEntries(KINDS.map((kind) => [kind, []])),
  catalogs: [],
  rulesync: { generate: false },
});
const configPath = ({ root, projectDir = process.cwd(), env = process.env } = {}) =>
  join(resolve(projectDir, resolveRoot({ root, env })), "atril.json");

function strings(value, field, fail) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${field} must be a list`);
  if (value.some((item) => typeof item !== "string" || !item.trim())) fail(`${field} items must be non-empty strings`);
  const repeated = value.find((item, index) => value.indexOf(item) !== index);
  if (repeated !== undefined) fail(`${field} item "${repeated}" is repeated`);
  return [...value];
}

function known(value, fields, prefix, fail) {
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail(`${prefix}${key} is not a known field`);
}

/** Validate a raw config and return it complete, defaults filled in. */
function normalize(raw, path) {
  const fail = (why) => { throw new Error(`${path}: ${why}`); };
  if (!isMapping(raw)) fail("atril.json must be a JSON object");
  known(raw, [...Object.keys(DEFAULT_CONFIG), "pluginConfig"], "", fail);
  const expose = raw.expose === undefined ? {} : raw.expose;
  if (!isMapping(expose)) fail("expose must be a mapping of kind to names");
  for (const kind of Object.keys(expose)) {
    if (!KINDS.includes(kind)) fail(`expose.${kind}: kind "${kind}" is not one of ${KINDS.join(", ")}`);
  }
  const exposed = Object.fromEntries(KINDS.map((kind) => [kind, strings(expose[kind], `expose.${kind}`, fail)]));
  for (const [kind, names] of Object.entries(exposed)) {
    const bad = names.find((name) => !SLUG.test(name));
    if (bad !== undefined) fail(`expose.${kind} item "${bad}" is not a slug (lowercase letters, digits, . _ -)`);
  }
  const rulesync = raw.rulesync === undefined ? {} : raw.rulesync;
  if (!isMapping(rulesync)) fail("rulesync must be a mapping");
  known(rulesync, ["generate"], "rulesync.", fail);
  const generate = rulesync.generate === undefined ? false : rulesync.generate;
  if (typeof generate !== "boolean") fail("rulesync.generate must be true or false");
  const pluginConfig = normalizePluginConfig(raw.pluginConfig, fail);
  return {
    targets: strings(raw.targets, "targets", fail),
    expose: exposed,
    catalogs: strings(raw.catalogs, "catalogs", fail),
    rulesync: { generate },
    ...(Object.keys(pluginConfig).length > 0 && { pluginConfig }),
  };
}

export const CONFIG_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

// `pluginConfig.<plugin>.<key>`: the non-sensitive user_config values, committed. Secrets never belong here.
function normalizePluginConfig(value, fail) {
  if (value === undefined) return {};
  if (!isMapping(value)) fail("pluginConfig must be a mapping of plugin to values");
  for (const [plugin, values] of Object.entries(value)) {
    if (!SAFE_NAME.test(plugin)) fail(`pluginConfig.${plugin} is not a plugin name (lowercase letters, digits and dashes)`);
    if (!isMapping(values)) fail(`pluginConfig.${plugin} must be a mapping of key to value`);
    for (const [key, item] of Object.entries(values)) {
      if (!CONFIG_KEY.test(key)) fail(`pluginConfig.${plugin}.${key} is not a valid key (letters, digits, underscores)`);
      const ok = ["string", "number", "boolean"].includes(typeof item) || (Array.isArray(item) && item.every((inner) => typeof inner === "string"));
      if (!ok) fail(`pluginConfig.${plugin}.${key} must be a string, number, boolean or list of strings`);
    }
  }
  return structuredClone(value);
}

/** @param {{ root?: string, projectDir?: string, env?: object }} [opts] */
export function readConfig(opts) {
  const path = configPath(opts);
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: invalid JSON (${err.message})`, { cause: err });
  }
  return normalize(raw, path);
}


/** Validate, then write through a temp file and a rename, so a reader never sees half a file. */
export function writeConfig(config, opts) {
  const path = configPath(opts);
  const text = `${JSON.stringify(normalize(config, path), sortKeys, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, text);
  return path;
}
