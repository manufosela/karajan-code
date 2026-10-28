/**
 * Marketplaces (ADR 0021, plan step 13a1): .claude-plugin/marketplace.json is read, its
 * name and plugins list validated, and every entry's source normalized. A relative path
 * is resolved against the marketplace and may not leave it. Errors name the file and the failing entry.
 * Reading only.
 */
import { isAbsolute, join, relative, resolve } from "node:path";
import { isMapping } from "./model.js";
import { readJson, SAFE_NAME } from "./plugin.js";
import { parsePluginSource } from "./plugin-source.js";

const isSafeName = (name) => typeof name === "string" && SAFE_NAME.test(name);

// A marketplace someone else wrote must not point an install anywhere on the machine.
const insideMarketplace = (dir, path) => {
  const resolved = resolve(dir, path);
  const rel = relative(dir, resolved);
  if (isAbsolute(path) || rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`a plugin path must stay inside the marketplace: ${path}`);
  return resolved;
};

const readEntry = (dir, entry) => {
  if (!isMapping(entry) || !isSafeName(entry.name)) throw new Error("a plugin needs a name made of letters, digits and dashes");
  const source = parsePluginSource(entry.source);
  return {
    name: entry.name,
    version: entry.version,
    description: entry.description,
    source: source.type === "path" ? { ...source, path: insideMarketplace(dir, source.path) } : source,
  };
};

export function readMarketplace(dir) {
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const marketplace = readJson(path);
  if (!isMapping(marketplace)) throw new Error(`${path}: a marketplace must be a JSON object`);
  if (!isSafeName(marketplace.name)) throw new Error(`${path}: a marketplace needs a name made of letters, digits and dashes`);
  if (!Array.isArray(marketplace.plugins)) throw new Error(`${path}: a marketplace needs a plugins list`);
  const seen = new Set();
  const plugins = marketplace.plugins.map((entry, index) => {
    try {
      const plugin = readEntry(dir, entry);
      if (seen.has(plugin.name)) throw new Error("a plugin name appears twice");
      seen.add(plugin.name);
      return plugin;
    } catch (error) {
      throw new Error(`${path}: plugins[${index}] (${JSON.stringify(entry?.name)}): ${error.message}`, { cause: error });
    }
  });
  return { name: marketplace.name, plugins };
}
