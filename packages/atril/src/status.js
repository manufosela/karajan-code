/**
 * Store status (ADR 0021, decisions 9 and 12; plan step 10b): per artifact, one state, the first
 * that holds: `missing` (in the lock, gone from disk), `edited` (its content hash is not the
 * recorded one; enrichment is not an edit), `uncurated` (no lock entry, or an origin outside the
 * configured catalogs), else `ok`. Read-only, like a scan.
 */
import { dirname, resolve } from "node:path";
import { catalogs } from "./catalog.js";
import { contentHash, readLock } from "./lock.js";
import { keyOf, resolveRoot, scanStore } from "./scan.js";

/** `local` and `import` are never curated; a plugin origin is while the lock still holds its plugin; a catalog origin is while its ref (and source) are still configured. */
function isCurated(origin, configured, plugins = {}) {
  if (origin?.origin === "plugin") return Object.hasOwn(plugins, origin.plugin);
  if (origin?.origin !== "catalog") return false;
  const catalog = configured.find(({ ref }) => ref === origin.catalog);
  if (!catalog) return false;
  return catalog.type !== "sources" || !origin.source || catalog.sources.some(({ source }) => source === origin.source);
}

/**
 * @param {{ root?: string, projectDir?: string, env?: object, recommended?: string }} [opts]
 * @returns {{ kind: string, name: string, state: "ok" | "edited" | "missing" | "uncurated", origin: object | null }[]}
 */
export function status(opts = {}) {
  const { projectDir = process.cwd(), env = process.env } = opts;
  const storeDir = resolve(projectDir, resolveRoot({ root: opts.root, env }));
  const held = new Map(scanStore(storeDir).map((artifact) => [keyOf(artifact), artifact]));
  const { artifacts: lock, plugins } = readLock(opts);
  const configured = catalogs(opts);
  // Code-unit order, not localeCompare: the order must not depend on the machine's locale.
  const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...new Set([...held.keys(), ...Object.keys(lock)])].sort(byCodeUnit).map((key) => {
    const entry = lock[key];
    const { hash, ...origin } = entry ?? {};
    const recorded = entry ? origin : null;
    const artifact = held.get(key);
    const [kind, name] = key.split(":");
    let state = "ok";
    if (!artifact) state = "missing";
    else if (entry && contentHash(kind === "skill" ? dirname(artifact.path) : artifact.path, kind) !== hash) state = "edited";
    else if (!isCurated(recorded, configured, plugins)) state = "uncurated";
    return { kind, name, state, origin: recorded };
  });
}
