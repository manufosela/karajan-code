/**
 * Plugin install (ADR 0021, plan step 13 P3b): finds a plugin in the catalogs, fetches it, shows
 * what it holds to `confirm`, installs its npm packages into the cache and its Markdown half into
 * the store. Hooks, MCP servers and bin/ are reported in `notInstalled`, never installed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findPlugin } from "./catalog.js";
import { readLock } from "./lock.js";
import { dependencyOrder, installNpmDeps, pluginDependencies } from "./plugin-deps.js";
import { fetchPlugin } from "./plugin-fetch.js";
import { installPluginMarkdown } from "./plugin-markdown.js";
import { readPluginManifest } from "./plugin.js";
import { pluginInventory } from "./plugin-trust.js";

// What the lock records of a source: never a local path, which would carry the home folder.
const LABEL = { github: (s) => s.repo, git: (s) => s.url, "git-subdir": (s) => `${s.url} (${s.path})` };

/**
 * The plugins to install for `name`, dependencies first and `name` last: every dependency is
 * resolved through findPlugin, recursively (matching by name only). A dependency already in the
 * lock is left out and not followed; `name` itself is always kept, so a reinstall still works.
 * A missing dependency names the plugin that needs it; a cycle names the loop.
 * @param {string} name
 * @param {Parameters<typeof findPlugin>[1]} [opts]
 * @param {{ git?: Function, gitBase?: string }} [how] how plugins are fetched to read their manifests
 * @returns {string[]}
 */
export function pluginInstallSet(name, opts = {}, { git, gitBase } = {}) {
  const installed = readLock(opts).plugins ?? {};
  const set = [];
  const visit = (plugin, neededBy) => {
    if (set.some((entry) => entry.name === plugin)) return;
    let manifest;
    try {
      const { source } = findPlugin(plugin, opts);
      manifest = readPluginManifest(fetchPlugin(source, { ...opts, name: plugin }, { git, gitBase }).dir).manifest;
    } catch (e) {
      throw new Error(neededBy ? `${neededBy} depends on ${plugin}: ${e.message}` : e.message, { cause: e });
    }
    const missing = pluginDependencies(manifest).filter((dep) => !Object.hasOwn(installed, dep.name));
    set.push({ name: plugin, manifest: { dependencies: missing } });
    for (const dep of missing) visit(dep.name, plugin);
  };
  visit(name);
  return dependencyOrder(set);
}

/**
 * @param {string} name a plugin a catalog offers
 * @param {{ projectDir?: string, root?: string, env?: object, commit?: string }} [opts] commit: the pin override
 * @param {{ confirm: (inventory: object, from: { source: object, commit?: string, status: string }) => boolean | Promise<boolean>, git?: Function, gitBase?: string, run?: Function }} [how]
 *   `confirm` is required and asked on every install, reinstalls included
 */
export async function installPlugin(name, opts = {}, { confirm, git, gitBase, run } = {}) {
  if (typeof confirm !== "function") throw new Error("installPlugin needs a confirm function");
  const { catalog, source } = findPlugin(name, opts);
  const fetched = fetchPlugin(source, { ...opts, name }, { git, gitBase });
  const inventory = pluginInventory(fetched.dir); // a broken file aborts here, before anything is written
  if (!(await confirm(inventory, { source, commit: fetched.commit, status: fetched.status }))) return { plugin: name, status: "declined", inventory };
  // npm writes only into the cache, which is kept; a cached copy that has its packages is not installed twice
  const npm = fetched.status === "cached" && existsSync(join(fetched.dir, "node_modules")) ? { status: "present" } : installNpmDeps(fetched.dir, { run });
  const label = LABEL[source.type]?.(source);
  // No try/catch and no rollback: installPluginMarkdown stages first, writes the lock last and undoes exactly what it created.
  const { plugin, entries } = installPluginMarkdown(fetched.dir, opts, { from: { catalog, ...(label && { source: label }), ...(fetched.commit && { commit: fetched.commit }) } });
  const { hooks, mcpServers, bin } = inventory;
  return { plugin, version: fetched.version, commit: fetched.commit, catalog, status: "installed", fetched: fetched.status, npm, entries, notInstalled: { hooks, mcpServers, bin } };
}
