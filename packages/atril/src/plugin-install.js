/**
 * Plugin install (ADR 0021, plan step 13 P3b): finds a plugin in the catalogs, fetches it, shows
 * what it holds to `confirm`, installs its npm packages into the cache and its Markdown half into
 * the store. Hooks, MCP servers and bin/ are reported in `notInstalled`, never installed.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeAtomic } from "./atomic.js";
import { findPlugin } from "./catalog.js";
import { lockPath, readLock } from "./lock.js";
import { writeDerived } from "./plugin-derived.js";
import { dependencyOrder, installNpmDeps, pluginDependencies } from "./plugin-deps.js";
import { fetchPlugin } from "./plugin-fetch.js";
import { installPluginMarkdown } from "./plugin-markdown.js";
import { nativeInstructions, pluginMode } from "./plugin-mode.js";
import { listPluginMarkdown, readPluginManifest } from "./plugin.js";
import { pluginPaths } from "./plugin-source.js";
import { pluginInventory } from "./plugin-trust.js";
import { importCanonical } from "./plugin-rulesync.js";
import { mergeEntries, removeEntries } from "./rulesync-entries.js";
import { resolveRoot } from "./scan.js";
import { remove, target } from "./store.js";

// A lock key `kind:name` as the { kind, storeName } of a plugin Markdown entry.
const entryOf = (key) => { const [kind, ...rest] = key.split(":"); return { kind, storeName: rest.join(":") }; };

// The exact bytes of the lock and of every store path `member` writes (and of `held`, the lock keys it replaces); restore() puts them back, deleting what was absent.
function snapshot({ fetched }, opts, held = []) {
  const lock = lockPath(opts);
  const lockBytes = existsSync(lock) ? readFileSync(lock) : null;
  const backup = mkdtempSync(join(tmpdir(), "atril-set-"));
  const paths = [...listPluginMarkdown(fetched.dir), ...held.map(entryOf)].map(({ kind, storeName }) => target(storeName, { ...opts, kind }));
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

// The native instruction of a dependency; one no catalog offers names the plugin that needs it.
function nativeInstructionsOf(dep, neededBy, opts) {
  try { return nativeInstructions(dep, findPlugin(dep, opts)); } catch (e) { throw new Error(`${neededBy} depends on ${dep}: ${e.message}`, { cause: e }); }
}

/**
 * The plugins to install for `name`, dependencies first and `name` last: every dependency is
 * resolved through findPlugin, recursively (matching by name only). A dependency already in the
 * lock is left out and not followed; `name` itself is always kept, so a reinstall still works.
 * A missing dependency names the plugin that needs it; a cycle names the loop.
 * `skipped` lists the dependencies left out: installed ones, and those whose pluginMode is skip or
 * native (never fetched or followed); `chosen` says which mode, with the native instruction.
 * @param {string} name
 * @param {Parameters<typeof findPlugin>[1]} [opts]
 * @param {{ git?: Function, gitBase?: string }} [how] how plugins are fetched to read their manifests
 * @returns {{ order: string[], skipped: string[] }}
 */
export function pluginInstallSet(name, opts = {}, { git, gitBase } = {}) {
  const installed = readLock(opts).plugins ?? {};
  const set = [];
  const skipped = [];
  const chosen = [];
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
    const missing = [];
    for (const entry of pluginDependencies(manifest)) {
      const dep = entry.name;
      const present = Object.hasOwn(installed, dep);
      const mode = pluginMode(dep, opts);
      if (!present && mode === "split") { missing.push(entry); continue; }
      if (skipped.includes(dep)) continue;
      // Left out and not followed (already there, skip or native): what it needs is not needed.
      skipped.push(dep);
      if (!present) chosen.push({ plugin: dep, mode, ...(mode === "native" && { instructions: nativeInstructionsOf(dep, plugin, opts) }) });
    }
    set.push({ name: plugin, manifest: { dependencies: missing } });
    for (const dep of missing) visit(dep.name, plugin);
  };
  visit(name);
  return { order: dependencyOrder(set), skipped, chosen, fetched };
}

// The pin override (`opts.commit`) is meant for the plugin asked for, never for its dependencies.
const pinFor = (plugin, target, { commit, ...rest }) => (plugin === target && commit !== undefined ? { ...rest, commit } : rest);

/**
 * @param {string} name a plugin a catalog offers
 * @param {{ projectDir?: string, root?: string, env?: object, commit?: string }} [opts] commit: the pin override
 * @param {{ confirm: (inventory: object, from: { source: object, commit?: string, status: string }) => boolean | Promise<boolean>, git?: Function, gitBase?: string, run?: Function }} [how]
 *   `confirm` is required and asked on every install, reinstalls included
 */
export async function installPlugin(name, opts = {}, { confirm, git, gitBase, run, rulesync } = {}) {
  if (typeof confirm !== "function") throw new Error("installPlugin needs a confirm function");
  const prepared = prepare(name, opts, { git, gitBase });
  // The shim: a single install still asks with one inventory and its origin.
  if (!(await confirm(prepared.inventory, { source: prepared.source, commit: prepared.fetched.commit, status: prepared.fetched.status }))) return { plugin: name, status: "declined", inventory: prepared.inventory };
  return commit(prepared, opts, { run, rulesync });
}

/** Finds, fetches and inventories a plugin; writes nothing (the cache aside). A broken file aborts here. */
function prepare(name, opts, { git, gitBase }, fetchedBefore) {
  const { catalog, source } = findPlugin(name, opts);
  const fetched = fetchedBefore ?? fetchPlugin(source, { ...opts, name }, { git, gitBase });
  return { name, catalog, source, fetched, inventory: pluginInventory(fetched.dir) };
}

/** Installs a prepared plugin: its npm packages into the cache, its Markdown into the store and the lock. */
function commit({ name, catalog, source, fetched, inventory }, opts, { run, rulesync }) {
  const { hooks, mcpServers, bin } = inventory;
  const projectDir = resolve(opts.projectDir ?? process.cwd());
  // Before anything is written: a failing import installs nothing. Without rulesync the hooks and MCP stay out (reported, nothing half done).
  const pluginCopy = pluginPaths(resolve(projectDir, resolveRoot(opts)), name, fetched.version).dir;
  const imported = hooks.length || mcpServers.length ? importCanonical(fetched.dir, { projectDir, pluginCopy }, rulesync) : undefined;
  // npm writes only into the cache, which is kept; a cached copy that has its packages is not installed twice
  const npm = fetched.status === "cached" && existsSync(join(fetched.dir, "node_modules")) ? { status: "present" } : installNpmDeps(fetched.dir, { run });
  const label = LABEL[source.type]?.(source);
  // No try/catch and no rollback: installPluginMarkdown stages first, writes the lock last and undoes exactly what it created.
  const dependencies = pluginDependencies(readPluginManifest(fetched.dir).manifest).map((dep) => dep.name);
  const merged = imported?.status === "imported";
  if (merged) mergeEntries(projectDir, name, imported.canonical);
  let installed;
  try {
    installed = installPluginMarkdown(fetched.dir, opts, { from: { catalog, ...(label && { source: label }), ...(fetched.commit && { commit: fetched.commit }), ...(dependencies.length && { dependencies }) } });
  } catch (error) {
    if (merged) removeEntries(projectDir, name);
    throw error;
  }
  const { plugin, entries } = installed;
  if (!imported) removeEntries(projectDir, name); // an update that drops every hook and MCP server drops what the old version wrote
  // The derived plugin is only written and listed: no host CLI runs (ADR 0042), so there is nothing for remove to undo.
  const derived = writeDerived(plugin, fetched.version, fetched.dir, { root: resolve(opts.projectDir ?? process.cwd(), resolveRoot(opts)), hooks: hooks.length, mcpServers: mcpServers.length });
  return { plugin, version: fetched.version, commit: fetched.commit, catalog, status: "installed", fetched: fetched.status, npm, entries, notInstalled: { hooks: merged ? [] : hooks, mcpServers: merged ? [] : mcpServers, bin }, ...(imported && { rulesync: { status: merged ? "merged" : "absent", ...(imported.needs && { needs: imported.needs }), ...(imported.rewritten && { rewritten: true }) } }), ...(derived && { derived }) };
}

/**
 * Installs `name` with the plugins it depends on, all or nothing: every member is prepared before
 * anything is written, `confirm` is asked once with all of them, and they are committed in
 * dependency order. A failure rolls back, in reverse, the members this run newly installed (a
 * reinstall is left as it was) and rethrows naming the failed member and what was rolled back.
 * @param {string} name
 * @param {Parameters<typeof installPlugin>[1]} [opts]
 * @param {{ confirm: (members: { name: string, inventory: object, source: object, commit?: string, status: string }[]) => boolean | Promise<boolean>, git?: Function, gitBase?: string, run?: Function }} [how]
 * @returns {Promise<object>} the target's result, plus `dependencies` (the other members, in install order), `skipped` and `chosen`
 */
export async function installPluginSet(name, opts = {}, { confirm, git, gitBase, run, rulesync } = {}) {
  if (typeof confirm !== "function") throw new Error("installPluginSet needs a confirm function");
  const mode = pluginMode(name, opts);
  if (mode !== "split") {
    // Nothing is fetched, confirmed or written; a copy installed as split earlier stays, and the user is told how to drop it.
    const removeWith = Object.hasOwn(readLock(opts).plugins ?? {}, name) ? { removeWith: `atril remove plugin:${name}` } : {};
    const instructions = mode === "native" ? { instructions: nativeInstructions(name, findPlugin(name, opts)) } : {};
    return { plugin: name, status: mode === "skip" ? "skipped" : "native", mode, dependencies: [], skipped: [], chosen: [], ...instructions, ...removeWith };
  }
  const { order, skipped, chosen, fetched } = pluginInstallSet(name, opts, { git, gitBase });
  // Reuses the fetch that read each manifest, so `confirm` sees "fetched" for what this run downloaded.
  const members = order.map((member) => prepare(member, pinFor(member, name, opts), { git, gitBase }, fetched[member]));
  // Every member is split here: one with no Markdown fails the whole set before anything is written.
  for (const { name: member, fetched } of members) if (listPluginMarkdown(fetched.dir).length === 0) throw new Error(`${member} has no Markdown to split: set its pluginMode to native or skip`);
  const asked = members.map(({ name: member, inventory, source, fetched }) => ({ name: member, mode, inventory, source, commit: fetched.commit, status: fetched.status }));
  if (!(await confirm(asked))) return { plugin: name, status: "declined", inventory: members.at(-1).inventory, dependencies: [], skipped, chosen };
  // Every snapshot is kept until the whole set succeeds: a failure restores them all, newest first, exactly as they
  // were. removePlugin is not used, it would delete an artifact a member adopted from a pre-existing identical one.
  const done = [];
  const snapshots = [];
  try {
    for (const member of members) {
      snapshots.push(snapshot(member, opts));
      done.push({ ...commit(member, opts, { run, rulesync }), mode });
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
  return { ...done.at(-1), dependencies: done.slice(0, -1), skipped, chosen };
}

// What a plugin can run: a change here is what the user is asked about again.
const executable = ({ hooks, mcpServers, bin, npm }) => JSON.stringify({ hooks, mcpServers, bin, npm });
// An installed copy that is gone or unreadable counts as changed: the user is asked rather than assumed.
const sameAsInstalled = (dir, inventory) => {
  try { return executable(pluginInventory(dir)) === executable(inventory); } catch { return false; }
};

/**
 * Brings an installed plugin to the commit its catalog pins now (`atril catalog update` moves the pin; an
 * unpinned source follows its ref). The new copy is fetched and inventoried first and `confirm` sees the
 * inventory before anything is written; when what it can run differs from the installed copy, `confirm` is
 * asked a second time (`again: true`). A failure puts the store paths and the lock back, byte for byte.
 * @param {string} name an installed plugin
 * @param {Parameters<typeof installPlugin>[1]} [opts]
 * @param {{ confirm: (inventory: object, info: { source: object, commit?: string, from?: string, status: string, changed: boolean, again?: boolean }) => boolean | Promise<boolean>, git?: Function, gitBase?: string, run?: Function }} [how]
 * @returns {Promise<{ plugin: string, status: "updated" | "current" | "declined", from?: string }>} "updated" also carries installPlugin's result
 */
export async function updatePlugin(name, opts = {}, { confirm, git, gitBase, run, rulesync } = {}) {
  if (typeof confirm !== "function") throw new Error("updatePlugin needs a confirm function");
  const { plugins, artifacts } = readLock(opts);
  const held = plugins?.[name];
  if (!held) throw new Error(`plugin "${name}" is not installed`);
  const mode = pluginMode(name, opts);
  if (mode !== "split") return { plugin: name, status: "kept", mode }; // left as installed; atril remove plugin:<name> drops it
  const prepared = prepare(name, opts, { git, gitBase });
  const { fetched, inventory } = prepared;
  if (fetched.commit && fetched.commit === held.commit) return { plugin: name, status: "current", version: held.version, commit: held.commit };
  for (const key of held.entries) if (artifacts[key] && (artifacts[key].origin !== "plugin" || artifacts[key].plugin !== name)) throw new Error(`${key} is not owned by plugin "${name}"; remove it by itself first`);
  // A local copy has no commit and its cache is replaced in place, so it keeps no baseline to compare with: always asked twice.
  const changed = !held.commit || !sameAsInstalled(pluginPaths(resolve(opts.projectDir ?? process.cwd(), resolveRoot(opts)), name, held.version).dir, inventory);
  const info = { source: prepared.source, commit: fetched.commit, from: held.commit, status: fetched.status, changed };
  if (!(await confirm(inventory, info)) || (changed && !(await confirm(inventory, { ...info, again: true })))) return { plugin: name, status: "declined", from: held.commit, inventory };
  const before = snapshot(prepared, opts, held.entries);
  try {
    for (const { kind, storeName } of held.entries.map(entryOf)) remove(storeName, { ...opts, kind });
    return { ...commit(prepared, opts, { run, rulesync }), status: "updated", from: held.commit };
  } catch (error) {
    let restored = "the previous store and lock";
    try { before.restore(); } catch (e) { restored = `nothing (restore failed: ${e.message})`; }
    throw new Error(`${error.message}; rolled back: ${restored}`, { cause: error });
  } finally {
    before.discard();
  }
}
