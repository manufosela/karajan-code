/**
 * Plugin remove (ADR 0021, plan step 13 P5): deletes the artifacts the lock lists for a plugin and
 * its `plugins` entry, all or nothing. Everything is moved aside first; the lock is written once;
 * a failure puts every piece back. `purge` also takes the plugin's cache and data folders.
 */
import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readLock, writeLock } from "./lock.js";
import { removeDerived } from "./plugin-derived.js";
import { pluginMode } from "./plugin-mode.js";
import { pluginDataDir } from "./plugin-vars.js";
import { resolveRoot } from "./scan.js";
import { target } from "./store.js";

/**
 * @param {string} name a plugin the lock's `plugins` section holds
 * @param {{ root?: string, projectDir?: string, env?: object, purge?: boolean, force?: boolean }} [opts] force: remove even while an installed plugin depends on it
 * @returns {{ plugin: string, removed: string[], purged: boolean, leftBehind?: string[] }} leftBehind: hidden folders the lock no longer knows, that could not be deleted
 */
export function removePlugin(name, { purge = false, force = false, ...opts } = {}) {
  const lock = readLock(opts);
  if (!Object.hasOwn(lock.plugins ?? {}, name)) {
    const mode = pluginMode(name, opts);
    if (mode === "split") throw new Error(`plugin "${name}" is not installed`);
    return { plugin: name, removed: [], purged: false, mode }; // skip and native leave nothing in the store
  }
  const dependents = Object.entries(lock.plugins).filter(([other, { dependencies = [] }]) => other !== name && dependencies.includes(name)).map(([other]) => other);
  if (dependents.length && !force) throw new Error(`plugin "${name}" is required by: ${dependents.join(", ")}; remove them first or pass --force`);
  const keys = lock.plugins[name].entries;
  for (const key of keys) {
    const held = lock.artifacts[key]; // absent: already gone from the lock, only the file is left
    const shared = Object.entries(lock.plugins).some(([other, { entries }]) => other !== name && entries.includes(key));
    if (shared || (held && (held.origin !== "plugin" || held.plugin !== name))) throw new Error(`${key} is not owned by plugin "${name}"; remove it by itself first`);
  }
  const root = resolve(opts.projectDir ?? process.cwd(), resolveRoot(opts));
  const paths = keys.map((key) => { const [kind, ...rest] = key.split(":"); return target(rest.join(":"), { ...opts, kind }); });
  if (purge) paths.push(join(root, "plugins", name), pluginDataDir(root, name));
  const moved = [];
  try {
    for (const path of paths.filter((p) => existsSync(p))) {
      const aside = join(dirname(path), `.${basename(path)}.removed.${randomUUID()}`);
      renameSync(path, aside);
      moved.push([path, aside]);
    }
    for (const key of keys) delete lock.artifacts[key];
    delete lock.plugins[name];
    if (!Object.keys(lock.plugins).length) delete lock.plugins;
    writeLock(lock, opts);
  } catch (error) {
    for (const [path, aside] of moved.toReversed()) renameSync(aside, path);
    throw error;
  }
  // The lock write was the commit: a leftover that cannot be deleted is reported, never a failed removal.
  const leftBehind = moved.flatMap(([, aside]) => {
    try { rmSync(aside, { recursive: true, force: true }); return []; } catch { return [aside]; }
  });
  const derived = removeDerived(name, root);
  return { plugin: name, removed: keys, purged: purge, ...(leftBehind.length && { leftBehind }), ...(derived && { derived }) };
}
