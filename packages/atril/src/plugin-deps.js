/**
 * Plugin dependencies (ADR 0021 decision 14, plan step 13g1-i): the plugins a manifest needs,
 * and the order to install a set of plugins in. Pure: it works on manifests the caller already
 * has. Matching is by name only; `marketplace` and `version` are carried, not checked.
 */
import { SAFE_NAME } from "./plugin.js";

const fromString = (entry) => {
  const at = entry.lastIndexOf("@");
  return at < 0 ? { name: entry } : { name: entry.slice(0, at), marketplace: entry.slice(at + 1) };
};

const parseEntry = (entry) => {
  const { name, marketplace, version } = typeof entry === "string" ? fromString(entry) : entry ?? {};
  if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error("the name must be lowercase letters, digits and dashes");
  if (marketplace !== undefined && !(typeof marketplace === "string" && SAFE_NAME.test(marketplace))) throw new Error("the marketplace must be lowercase letters, digits and dashes");
  if (version !== undefined && !(typeof version === "string" && version !== "")) throw new Error("the version must be a non-empty string");
  return { name, ...(marketplace !== undefined && { marketplace }), ...(version !== undefined && { version }) };
};

/** The `{ name, marketplace?, version? }` entries of a manifest's `dependencies`. */
export const pluginDependencies = (manifest) => {
  const list = manifest.dependencies;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("dependencies must be a list");
  return list.map((entry, i) => {
    try {
      return parseEntry(entry);
    } catch (e) {
      throw new Error(`dependencies[${i}] (${JSON.stringify(entry)}): ${e.message}`, { cause: e });
    }
  });
};

/** The names of `plugins` ({ name, manifest }[]), each one after every plugin it depends on. */
export const dependencyOrder = (plugins) => {
  const needs = new Map();
  for (const { name, manifest } of plugins) {
    if (needs.has(name)) throw new Error(`plugin "${name}" is listed twice`);
    try {
      needs.set(name, pluginDependencies(manifest).map((d) => d.name));
    } catch (e) {
      throw new Error(`${name}: ${e.message}`, { cause: e });
    }
  }
  const position = new Map([...needs.keys()].map((name, i) => [name, i]));
  const order = [];
  const done = new Set();
  const visit = (name, path) => {
    if (done.has(name)) return;
    if (path.includes(name)) throw new Error(`plugin dependency cycle: ${[...path.slice(path.indexOf(name)), name].join(" -> ")}`);
    for (const dep of needs.get(name)) {
      if (!needs.has(dep)) throw new Error(`${name} depends on ${dep}, which is not among the plugins to install`);
    }
    // Dependencies are visited in input order, so ties never depend on how a manifest lists them.
    for (const dep of [...needs.get(name)].sort((x, y) => position.get(x) - position.get(y))) visit(dep, [...path, name]);
    done.add(name);
    order.push(name);
  };
  for (const name of needs.keys()) visit(name, []);
  return order;
};
