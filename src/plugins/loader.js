/**
 * Plugin loader: discovers and loads plugins from .karajan/plugins/ directories.
 *
 * Plugins are JS files that export a `register(api)` function.
 * The `api` object provides: registerAgent, registerModel.
 *
 * Discovery order (all are loaded, not first-wins):
 *   1. <project>/.karajan/plugins/*.js
 *   2. ~/.karajan/plugins/*.js
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { getKarajanHome } from "../utils/paths.js";
import { registerAgent } from "../agents/index.js";

async function listPluginFiles(dir) {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => path.join(dir, e.name));
  } catch { /* plugin dir does not exist */
    return [];
  }
}

async function loadPlugin(filePath, api, logger) {
  try {
    const mod = await import(pathToFileURL(filePath).href);
    const registerFn = mod.register || mod.default?.register;
    if (typeof registerFn !== "function") {
      logger?.warn?.(`Plugin ${filePath}: no register() export found, skipping`);
      return null;
    }
    const meta = registerFn(api);
    const name = meta?.name || path.basename(filePath, ".js");
    logger?.debug?.(`Plugin loaded: ${name} (${filePath})`);
    return { name, path: filePath, meta };
  } catch (error) {
    logger?.warn?.(`Plugin ${filePath} failed to load: ${error.message}`);
    return null;
  }
}

export async function loadPlugins({ projectDir, logger } = {}) {
  const dirs = [];

  if (projectDir) {
    dirs.push(path.join(projectDir, ".karajan", "plugins"));
  }
  dirs.push(path.join(getKarajanHome(), "plugins"));

  const api = { registerAgent };

  const loaded = [];
  for (const dir of dirs) {
    const files = await listPluginFiles(dir);
    for (const file of files) {
      const result = await loadPlugin(file, api, logger);
      if (result) loaded.push(result);
    }
  }

  return loaded;
}
