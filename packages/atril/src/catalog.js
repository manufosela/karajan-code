/**
 * Catalogs (ADR 0021, decision 12; plan step 11a). Each entry of atril.json's `catalogs`,
 * relative to the project, is either a folder in a store's layout (a bundled catalog, such as
 * a consumer's own or the recommended set) or a JSON file of git sources:
 * `{ "sources": [{ "source": "owner/repo[/path]", "commit": "<40 hex>", "note": "..." }] }`,
 * each pinned to a commit and saying what it is for. What a catalog offers that the stores do
 * not hold is "available": search shows it, installing it stays an explicit step.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { readConfig } from "./config.js";
import { isMapping } from "./model.js";
import { keyOf, resolveRoot, scan, scanStore } from "./scan.js";

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const isSource = (source) => typeof source === "string"
  && source.split("/").length >= 2
  && source.split("/").every((part) => SEGMENT.test(part) && part !== "." && part !== "..");

function readSources(ref, file) {
  const fail = (why, cause) => { throw new Error(`catalog "${ref}": ${why}`, { cause }); };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    fail(`invalid JSON (${err.message})`, err);
  }
  if (!isMapping(raw) || !Array.isArray(raw.sources)) fail('must be { "sources": [...] }');
  return raw.sources.map((entry, index) => {
    if (!isMapping(entry)) fail(`sources[${index}] must be an object`);
    const { source, commit, note } = entry;
    if (!isSource(source)) fail(`source ${JSON.stringify(source)} is not owner/repo[/path]`);
    if (typeof commit !== "string" || !COMMIT.test(commit)) fail(`source "${source}": commit must be 40 hex characters (a pinned commit)`);
    if (typeof note !== "string" || !note.trim()) fail(`source "${source}": a note on what it is for is required`);
    return { source, commit, note };
  });
}

/** Where fetched sources live: under the store, never scanned as artifacts (a dot folder). */
export const cacheRoot = ({ projectDir = process.cwd(), root, env = process.env } = {}) =>
  join(resolvePath(projectDir, resolveRoot({ root, env })), ".cache", "catalogs");

/** A source's pinned commit in the cache; owner and repo are validated segments. */
export function sourceDir(opts, { source, commit }) {
  const [owner, repo] = source.split("/");
  return join(cacheRoot(opts), owner, repo, commit);
}

/** @param {{ projectDir?: string, root?: string, env?: object }} [opts] */
export function catalogs(opts = {}) {
  const projectDir = opts.projectDir ?? process.cwd();
  return readConfig(opts).catalogs.map((ref) => {
    const path = resolvePath(projectDir, ref);
    if (!existsSync(path)) throw new Error(`catalog "${ref}": ${path} not found`);
    if (statSync(path).isDirectory()) return { ref, type: "store", dir: path };
    return { ref, type: "sources", sources: readSources(ref, path) };
  });
}

/**
 * What the catalogs offer that the stores do not hold, each with its `catalog`. The first
 * catalog listed wins a name two of them share. A sources catalog joins once fetched (step 11b).
 * @param {Parameters<typeof scan>[0]} [opts]
 * @param {object[]} [held] the stores' artifacts, when the caller already scanned them
 */
export function availableArtifacts(opts = {}, held = scan(opts).artifacts) {
  const seen = new Set(held.map(keyOf));
  const found = [];
  for (const catalog of catalogs(opts).filter(({ type }) => type === "store")) {
    for (const artifact of scanStore(catalog.dir, `catalog:${catalog.ref}`)) {
      if (seen.has(keyOf(artifact))) continue;
      seen.add(keyOf(artifact));
      found.push({ ...artifact, catalog: catalog.ref });
    }
  }
  return found;
}
