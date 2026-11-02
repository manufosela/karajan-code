/**
 * Plugin remove (ADR 0021, plan step 13 P5): deletes the artifacts the lock lists for a plugin and
 * its `plugins` entry, all or nothing. Everything is moved aside first; the lock is written once;
 * a failure puts every piece back. `purge` also takes the plugin's cache and data folders.
 */
import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readLock, writeLock } from "./lock.js";
import { pluginDataDir } from "./plugin-vars.js";
import { resolveRoot } from "./scan.js";
import { target } from "./store.js";

/**
 * @param {string} name a plugin the lock's `plugins` section holds
 * @param {{ root?: string, projectDir?: string, env?: object, purge?: boolean }} [opts]
 * @returns {{ plugin: string, removed: string[], purged: boolean, leftBehind?: string[] }} leftBehind: hidden folders the lock no longer knows, that could not be deleted
 */
export function removePlugin(name, { purge = false, ...opts } = {}) {
  const lock = readLock(opts);
  if (!Object.hasOwn(lock.plugins ?? {}, name)) throw new Error(`plugin "${name}" is not installed`);
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
  return { plugin: name, removed: keys, purged: purge, ...(leftBehind.length && { leftBehind }) };
}
