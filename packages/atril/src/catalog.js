/**
 * Catalogs (ADR 0021, decision 12; plan step 11a). Each entry of atril.json's `catalogs`,
 * relative to the project, is either a folder in a store's layout (a bundled catalog, such as
 * a consumer's own or the recommended set) or a JSON file of git sources:
 * `{ "sources": [{ "source": "owner/repo[/path]", "commit": "<40 hex>", "note": "..." }] }`,
 * each pinned to a commit and saying what it is for. What a catalog offers that the stores do
 * not hold is "available": search shows it, installing it stays an explicit step. The set atril
 * recommends (decision 13; plan step 12a) ships in the package and is always the first catalog.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { isMapping, parseArtifact } from "./model.js";
import { keyOf, resolveRoot, scan, scanStore } from "./scan.js";

export const RECOMMENDED = fileURLToPath(new URL("../recommended", import.meta.url));

/**
 * The recommended set's folder: the option wins, then ATRIL_RECOMMENDED (relative to the
 * project), then the bundled one. A set named explicitly must exist.
 */
export function recommendedDir({ recommended, projectDir = process.cwd(), env = process.env } = {}) {
  const chosen = recommended || env.ATRIL_RECOMMENDED;
  if (!chosen) return RECOMMENDED;
  const dir = resolvePath(projectDir, chosen);
  if (!existsSync(dir)) throw new Error(`recommended set ${dir} not found`);
  return dir;
}

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
  const seen = new Set();
  return raw.sources.map((entry, index) => {
    if (!isMapping(entry)) fail(`sources[${index}] must be an object`);
    const { source, commit, note } = entry;
    if (!isSource(source)) fail(`source ${JSON.stringify(source)} is not owner/repo[/path]`);
    // One pin per source: an update moves exactly one entry.
    if (seen.has(source)) fail(`source "${source}" is listed twice`);
    seen.add(source);
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

/** @param {{ projectDir?: string, root?: string, env?: object, recommended?: string }} [opts] */
export function catalogs(opts = {}) {
  const projectDir = opts.projectDir ?? process.cwd();
  const bundled = { ref: "atril:recommended", type: "store", dir: recommendedDir(opts) };
  return [bundled, ...readConfig(opts).catalogs.map((ref) => {
    const path = resolvePath(projectDir, ref);
    if (!existsSync(path)) throw new Error(`catalog "${ref}": ${path} not found`);
    if (statSync(path).isDirectory()) return { ref, type: "store", dir: path };
    return { ref, type: "sources", sources: readSources(ref, path) };
  })];
}

/**
 * A fetched source (step 11b): a store's layout, one OpenSkills skill folder, or a folder of
 * them. A SKILL.md that declares no kind is a skill, and must be named after its folder.
 */
function scanFetched(dir, source) {
  if (["skills", "commands", "agents"].some((kind) => existsSync(join(dir, kind)))) return scanStore(dir, source);
  const skillAt = (folder) => {
    const artifact = parseArtifact(join(folder, "SKILL.md"), { defaultKind: "skill" });
    if (artifact.kind !== "skill" || artifact.name !== basename(folder)) {
      throw new Error(`${folder}: a catalog skill must be kind skill and named after its folder, not "${artifact.name}"`);
    }
    return { ...artifact, source };
  };
  if (existsSync(join(dir, "SKILL.md"))) return [skillAt(dir)];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .toSorted()
    .map((name) => skillAt(join(dir, name)));
}

/** The folders a catalog offers: a store catalog itself, or each source already fetched. */
function offered(opts, catalog) {
  if (catalog.type === "store") return [{ dir: catalog.dir, scanOf: scanStore }];
  return catalog.sources
    .map((entry) => join(sourceDir(opts, entry), ...entry.source.split("/").slice(2)))
    .filter((dir) => existsSync(dir))
    .map((dir) => ({ dir, scanOf: scanFetched }));
}

/**
 * What the catalogs offer that the stores do not hold, each with its `catalog`. The first
 * catalog listed wins a name two of them share; a source not fetched yet offers nothing.
 * @param {Parameters<typeof scan>[0]} [opts]
 * @param {object[]} [held] the stores' artifacts, when the caller already scanned them
 */
export function availableArtifacts(opts = {}, held = scan(opts).artifacts) {
  const seen = new Set(held.map(keyOf));
  const found = [];
  for (const catalog of catalogs(opts)) {
    for (const { dir, scanOf } of offered(opts, catalog)) {
      for (const artifact of scanOf(dir, `catalog:${catalog.ref}`)) {
        if (seen.has(keyOf(artifact))) continue;
        seen.add(keyOf(artifact));
        found.push({ ...artifact, catalog: catalog.ref });
      }
    }
  }
  return found;
}
