/**
 * Plugin install (ADR 0021, plan step 13 P3b): finds a plugin in the catalogs, fetches it, shows
 * what it holds to `confirm`, installs its npm packages into the cache and its Markdown half into
 * the store. Hooks, MCP servers and bin/ are reported in `notInstalled`, never installed.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { findPlugin } from "./catalog.js";
import { lockPath, readLock } from "./lock.js";
import { dependencyOrder, installNpmDeps, pluginDependencies } from "./plugin-deps.js";
import { fetchPlugin } from "./plugin-fetch.js";
import { installPluginMarkdown } from "./plugin-markdown.js";
import { listPluginMarkdown, readPluginManifest } from "./plugin.js";
import { pluginInventory } from "./plugin-trust.js";
import { target } from "./store.js";

// The exact bytes of the lock and of every store path `member` writes; restore() puts them back, deleting what was absent.
function snapshot({ fetched }, opts) {
  const lock = lockPath(opts);
  const lockBytes = existsSync(lock) ? readFileSync(lock) : null;
  const backup = mkdtempSync(join(tmpdir(), "atril-set-"));
  const paths = listPluginMarkdown(fetched.dir).map(({ kind, storeName }) => target(storeName, { ...opts, kind }));
  const kept = paths.map((path, i) => existsSync(path) && (cpSync(path, join(backup, String(i)), { recursive: true }), true));
  return {
    restore() {
      paths.forEach((path, i) => {
        rmSync(path, { recursive: true, force: true });
        if (kept[i]) cpSync(join(backup, String(i)), path, { recursive: true });
      });
      if (lockBytes) writeAtomic(lock, lockBytes);
      else rmSync(lock, { force: true });
    },
    discard: () => rmSync(backup, { recursive: true, force: true }),
  };
}

// What the lock records of a source: never a local path, which would carry the home folder.
const LABEL = { github: (s) => s.repo, git: (s) => s.url, "git-subdir": (s) => `${s.url} (${s.path})` };

/**
 * The plugins to install for `name`, dependencies first and `name` last: every dependency is
 * resolved through findPlugin, recursively (matching by name only). A dependency already in the
 * lock is left out and not followed; `name` itself is always kept, so a reinstall still works.
 * A missing dependency names the plugin that needs it; a cycle names the loop.
 * `skipped` lists the installed dependencies that were left out.
 * @param {string} name
 * @param {Parameters<typeof findPlugin>[1]} [opts]
 * @param {{ git?: Function, gitBase?: string }} [how] how plugins are fetched to read their manifests
 * @returns {{ order: string[], skipped: string[] }}
 */
export function pluginInstallSet(name, opts = {}, { git, gitBase } = {}) {
  const installed = readLock(opts).plugins ?? {};
  const set = [];
  const skipped = [];
  const fetched = {};
  const visit = (plugin, neededBy) => {
    if (set.some((entry) => entry.name === plugin)) return;
    let manifest;
    try {
      const { source } = findPlugin(plugin, opts);
      fetched[plugin] = fetchPlugin(source, { ...pinFor(plugin, name, opts), name: plugin }, { git, gitBase });
      manifest = readPluginManifest(fetched[plugin].dir).manifest;
    } catch (e) {
      throw new Error(neededBy ? `${neededBy} depends on ${plugin}: ${e.message}` : e.message, { cause: e });
    }
    const deps = pluginDependencies(manifest);
    const missing = deps.filter((dep) => !Object.hasOwn(installed, dep.name));
    for (const dep of deps) if (Object.hasOwn(installed, dep.name) && !skipped.includes(dep.name)) skipped.push(dep.name);
    set.push({ name: plugin, manifest: { dependencies: missing } });
    for (const dep of missing) visit(dep.name, plugin);
  };
  visit(name);
  return { order: dependencyOrder(set), skipped, fetched };
}

// The pin override (`opts.commit`) is meant for the plugin asked for, never for its dependencies.
const pinFor = (plugin, target, { commit, ...rest }) => (plugin === target && commit !== undefined ? { ...rest, commit } : rest);

/**
 * @param {string} name a plugin a catalog offers
 * @param {{ projectDir?: string, root?: string, env?: object, commit?: string }} [opts] commit: the pin override
 * @param {{ confirm: (inventory: object, from: { source: object, commit?: string, status: string }) => boolean | Promise<boolean>, git?: Function, gitBase?: string, run?: Function }} [how]
 *   `confirm` is required and asked on every install, reinstalls included
 */
export async function installPlugin(name, opts = {}, { confirm, git, gitBase, run } = {}) {
  if (typeof confirm !== "function") throw new Error("installPlugin needs a confirm function");
  const prepared = prepare(name, opts, { git, gitBase });
  // The shim: a single install still asks with one inventory and its origin.
  if (!(await confirm(prepared.inventory, { source: prepared.source, commit: prepared.fetched.commit, status: prepared.fetched.status }))) return { plugin: name, status: "declined", inventory: prepared.inventory };
  return commit(prepared, opts, { run });
}

/** Finds, fetches and inventories a plugin; writes nothing (the cache aside). A broken file aborts here. */
function prepare(name, opts, { git, gitBase }, fetchedBefore) {
  const { catalog, source } = findPlugin(name, opts);
  const fetched = fetchedBefore ?? fetchPlugin(source, { ...opts, name }, { git, gitBase });
  return { name, catalog, source, fetched, inventory: pluginInventory(fetched.dir) };
}

/** Installs a prepared plugin: its npm packages into the cache, its Markdown into the store and the lock. */
function commit({ catalog, source, fetched, inventory }, opts, { run }) {
  // npm writes only into the cache, which is kept; a cached copy that has its packages is not installed twice
  const npm = fetched.status === "cached" && existsSync(join(fetched.dir, "node_modules")) ? { status: "present" } : installNpmDeps(fetched.dir, { run });
  const label = LABEL[source.type]?.(source);
  // No try/catch and no rollback: installPluginMarkdown stages first, writes the lock last and undoes exactly what it created.
  const { plugin, entries } = installPluginMarkdown(fetched.dir, opts, { from: { catalog, ...(label && { source: label }), ...(fetched.commit && { commit: fetched.commit }) } });
  const { hooks, mcpServers, bin } = inventory;
  return { plugin, version: fetched.version, commit: fetched.commit, catalog, status: "installed", fetched: fetched.status, npm, entries, notInstalled: { hooks, mcpServers, bin } };
}

/**
 * Installs `name` with the plugins it depends on, all or nothing: every member is prepared before
 * anything is written, `confirm` is asked once with all of them, and they are committed in
 * dependency order. A failure rolls back, in reverse, the members this run newly installed (a
 * reinstall is left as it was) and rethrows naming the failed member and what was rolled back.
 * @param {string} name
 * @param {Parameters<typeof installPlugin>[1]} [opts]
 * @param {{ confirm: (members: { name: string, inventory: object, source: object, commit?: string, status: string }[]) => boolean | Promise<boolean>, git?: Function, gitBase?: string, run?: Function }} [how]
 * @returns {Promise<object>} the target's result, plus `dependencies` (the other members, in install order) and `skipped`
 */
export async function installPluginSet(name, opts = {}, { confirm, git, gitBase, run } = {}) {
  if (typeof confirm !== "function") throw new Error("installPluginSet needs a confirm function");
  const { order, skipped, fetched } = pluginInstallSet(name, opts, { git, gitBase });
  // Reuses the fetch that read each manifest, so `confirm` sees "fetched" for what this run downloaded.
  const members = order.map((member) => prepare(member, pinFor(member, name, opts), { git, gitBase }, fetched[member]));
  const asked = members.map(({ name: member, inventory, source, fetched }) => ({ name: member, inventory, source, commit: fetched.commit, status: fetched.status }));
  if (!(await confirm(asked))) return { plugin: name, status: "declined", inventory: members.at(-1).inventory, dependencies: [], skipped };
  // Every snapshot is kept until the whole set succeeds: a failure restores them all, newest first, exactly as they
  // were. removePlugin is not used, it would delete an artifact a member adopted from a pre-existing identical one.
  const done = [];
  const snapshots = [];
  try {
    for (const member of members) {
      snapshots.push(snapshot(member, opts));
      done.push(commit(member, opts, { run }));
    }
  } catch (error) {
    const failed = members[done.length].name;
    const restored = [];
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const label = members[i].name;
      try { snapshots[i].restore(); if (i < done.length) restored.push(label); } catch (e) { restored.push(`${label} (restore failed: ${e.message})`); }
    }
    throw new Error(`${failed}: ${error.message}; rolled back: ${restored.length ? restored.join(", ") : "nothing"}`, { cause: error });
  } finally {
    for (const before of snapshots) before.discard();
  }
  return { ...done.at(-1), dependencies: done.slice(0, -1), skipped };
}
