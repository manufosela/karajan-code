/**
 * A plugin's path variables (ADR 0021 decision 14): the store keeps the author's text, variables
 * and all, so its hashes are the same on every machine. `resolve` fills them from THIS machine's
 * cache and data folders; anything it cannot fill stays as written and is reported, never emptied.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readLock } from "./lock.js";
import { SAFE_NAME } from "./plugin.js";
import { pluginPaths } from "./plugin-source.js";
import { keyOf, resolveRoot } from "./scan.js";

const VARIABLE = /\$\{(CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|PLUGIN_DATA|CLAUDE_SKILL_DIR|user_config\.[A-Za-z_][A-Za-z0-9_]*)\}/g;
const DATA = /\$\{(?:CLAUDE_)?PLUGIN_DATA\}/;

/** Whether a text names a plugin path variable, whatever its value would be. */
export const usesPluginVars = (text) => text.search(VARIABLE) !== -1;

/** Where a plugin keeps data that survives updates: outside the version folders, and no plugin name starts with ".". */
export function pluginDataDir(root, name) {
  if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error(`plugin name "${name}" is not safe (lowercase letters, digits and dashes)`);
  return join(root, "plugins", ".data", name);
}

/**
 * Pure. A replacer function keeps `$&` or `$1` in a path literal. A variable with no value stays
 * as written and is reported; runtime, brace-less and shell variables are left unreported.
 * `${user_config.*}` waits for step 13c3 part ii: reported as undeclared.
 * @param {string} text
 * @param {Record<string, string>} values by variable name
 * @returns {{ text: string, unresolved: { variable: string, reason: string }[] }}
 */
export function substitutePluginVars(text, values) {
  const unresolved = [];
  const out = text.replace(VARIABLE, (whole, variable) => {
    if (variable.startsWith("user_config.")) unresolved.push({ variable, reason: "undeclared" });
    else if (Object.hasOwn(values, variable)) return values[variable];
    else unresolved.push({ variable, reason: "no value" });
    return whole;
  });
  return { text: out, unresolved };
}

// Where a plugin artifact's plugin lives on this machine, or why that is unknown: the lock names
// the plugin and its version, the version names the cache folder. The user store has no lock here.
function locate(artifact, lock, store) {
  const entry = artifact.source === "project" ? lock.artifacts[keyOf(artifact)] : undefined;
  if (entry?.origin !== "plugin") return { reason: "no lock entry", hint: "reinstall the plugin in this store" };
  const plugin = Object.hasOwn(lock.plugins ?? {}, entry.plugin) ? lock.plugins[entry.plugin] : undefined;
  if (!plugin) return { reason: "plugin not in the lock" };
  if (typeof plugin.version !== "string" || !SAFE_NAME.test(entry.plugin)) {
    return { reason: "no usable version in the lock", hint: "install the plugin again" };
  }
  const { dir } = pluginPaths(store, entry.plugin, plugin.version);
  if (existsSync(dir)) return { name: entry.plugin, dir };
  return { name: entry.plugin, reason: "not cached", hint: `the plugin's cache ${dir} is missing on this machine; fetch the plugin again` };
}

/**
 * Fills a plugin artifact's text when it is resolved. Only artifacts marked `atril.plugin` are
 * touched, and the lock is read once, on the first of them. `unresolved` fills up as
 * { ref, variable, reason, hint? }. The data folder is created when a text names it.
 * @param {{ root?: string, projectDir?: string, env?: object }} [opts] the store, as scan() takes it
 */
export function pluginSubstituter(opts = {}) {
  const store = resolve(opts.projectDir ?? process.cwd(), resolveRoot(opts));
  const unresolved = [];
  const done = new Map();
  let lock;
  const fill = (artifact, text) => {
    if (!artifact.atril?.plugin) return text;
    const memo = `${artifact.path}\0${text}`;
    if (done.has(memo)) return done.get(memo);
    lock ??= readLock(opts);
    const where = locate(artifact, lock, store);
    const values = artifact.kind === "skill" ? { CLAUDE_SKILL_DIR: dirname(artifact.path) } : {};
    if (where.name) {
      const data = pluginDataDir(store, where.name);
      if (DATA.test(text)) mkdirSync(data, { recursive: true });
      Object.assign(values, { CLAUDE_PLUGIN_DATA: data, PLUGIN_DATA: data });
    }
    if (where.dir) Object.assign(values, { CLAUDE_PLUGIN_ROOT: where.dir, PLUGIN_ROOT: where.dir });
    const filled = substitutePluginVars(text, values);
    for (const { variable, reason } of filled.unresolved) {
      // A skill always has CLAUDE_SKILL_DIR, so an unfilled one belongs to a command or an agent.
      const why = variable === "CLAUDE_SKILL_DIR" ? { reason: "skill-only" } : reason === "undeclared" ? { reason } : where;
      unresolved.push({ ref: keyOf(artifact), variable, reason: why.reason, ...(why.hint && { hint: why.hint }) });
    }
    done.set(memo, filled.text);
    return filled.text;
  };
  return { fill, unresolved };
}
