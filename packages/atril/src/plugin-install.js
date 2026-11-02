/**
 * Plugin install (ADR 0021, plan step 13 P3b): finds a plugin in the catalogs, fetches it, shows
 * what it holds to `confirm`, installs its npm packages into the cache and its Markdown half into
 * the store. Hooks, MCP servers and bin/ are reported in `notInstalled`, never installed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findPlugin } from "./catalog.js";
import { installNpmDeps } from "./plugin-deps.js";
import { fetchPlugin } from "./plugin-fetch.js";
import { installPluginMarkdown } from "./plugin-markdown.js";
import { pluginInventory } from "./plugin-trust.js";

// What the lock records of a source: never a local path, which would carry the home folder.
const LABEL = { github: (s) => s.repo, git: (s) => s.url, "git-subdir": (s) => `${s.url} (${s.path})` };

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
