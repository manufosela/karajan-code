/**
 * The store's lockfile (ADR 0021, decision 10): `<root>/atril.lock.json` maps
 * `kind:name` to origin and content hash. Committed, so no timestamp and no
 * local path. Absent = empty lock; reading never writes; a bad entry fails loudly.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { writeAtomic } from "./atomic.js";
import { hashContent } from "./ledger.js";
import { isMapping, KINDS, parseArtifact, SLUG, sortKeys } from "./model.js";
import { resolveRoot } from "./scan.js";
export const LOCK_FILE = "atril.lock.json";
const ORIGINS = ["catalog", "local", "import", "plugin"];
const FIELDS = ["origin", "catalog", "source", "commit", "from", "plugin", "hash"];
const PLUGIN_FIELDS = ["catalog", "source", "commit", "version", "entries"];
const KEY = new RegExp(`^(${KINDS.join("|")}):${SLUG.source.slice(1)}`);
export const lockPath = ({ root, projectDir = process.cwd(), env = process.env } = {}) =>
  join(resolve(projectDir, resolveRoot({ root, env })), LOCK_FILE);
/** A command or agent: the parsed hash (ignores the `atril:` block). A skill: that hash plus every other file of the folder. */
export function contentHash(path, kind, parseOpts) {
  if (kind !== "skill") return parseArtifact(path).hash;
  const entries = readdirSync(path, { recursive: true, withFileTypes: true });
  const link = entries.find((e) => e.isSymbolicLink());
  if (link) throw new Error(`${join(link.parentPath, link.name)}: a skill may not hold symlinks`);
  const parts = entries
    .filter((e) => e.isFile())
    .map((e) => relative(path, join(e.parentPath, e.name)).split(sep).join("/"))
    .filter((rel) => rel !== "SKILL.md")
    .toSorted()
    .map((rel) => `${rel}\n${hashContent(readFileSync(join(path, rel)))}`);
  return hashContent([parseArtifact(join(path, "SKILL.md"), parseOpts).hash, ...parts].join("\n"));
}
/** The optional top-level `plugins` section: `<name>: { catalog, source, commit, version, entries }`, entries being lock keys. */
function validatePlugins(plugins, fail) {
  if (!isMapping(plugins)) fail("plugins must be a mapping");
  for (const [name, entry] of Object.entries(plugins)) {
    const bad = (why) => fail(`plugin "${name}": ${why}`);
    if (!isMapping(entry)) bad("must be a mapping");
    const unknown = Object.keys(entry).find((field) => !PLUGIN_FIELDS.includes(field));
    if (unknown) bad(`${unknown} is not a known field`);
    const text = ["catalog", "source", "version"].find((field) => entry[field] !== undefined && !(typeof entry[field] === "string" && entry[field]));
    if (text) bad(`${text} must be a non-empty string`);
    if (entry.commit !== undefined && !(typeof entry.commit === "string" && /^[0-9a-f]{40}$/.test(entry.commit))) bad("commit must be 40 hex");
    if (!Array.isArray(entry.entries) || !entry.entries.every((key) => typeof key === "string" && KEY.test(key))) bad("entries must be a list of kind:slug keys");
  }
}
function validate(lock, path) {
  const fail = (why) => { throw new Error(`${path}: ${why}`); };
  if (!isMapping(lock) || lock.version !== 1 || !isMapping(lock.artifacts)) fail("expected { version: 1, artifacts: {} }");
  for (const [key, entry] of Object.entries(lock.artifacts)) {
    const bad = (why) => fail(`entry "${key}": ${why}`);
    if (!KEY.test(key)) fail(`entry "${key}" is not kind:slug`);
    if (!isMapping(entry)) bad("must be a mapping");
    const unknown = Object.keys(entry).find((field) => !FIELDS.includes(field));
    if (unknown) bad(`${unknown} is not a known field`);
    const text = ["catalog", "source", "from", "plugin"].find((field) => entry[field] !== undefined && !(typeof entry[field] === "string" && entry[field]));
    if (text) bad(`${text} must be a non-empty string`);
    if (!ORIGINS.includes(entry.origin)) bad(`origin must be one of ${ORIGINS.join(", ")}`);
    if (entry.origin === "plugin" && entry.plugin === undefined) bad("a plugin origin needs the plugin name");
    if (!/^sha256:[0-9a-f]{64}$/.test(entry.hash)) bad("hash must be sha256:<64 hex>");
    if (entry.commit !== undefined && !/^[0-9a-f]{40}$/.test(entry.commit)) bad("commit must be 40 hex");
  }
  if (lock.plugins !== undefined) validatePlugins(lock.plugins, fail);
  return lock;
}
/** @param {{ root?: string, projectDir?: string, env?: object }} [opts] */
export function readLock(opts) {
  const path = lockPath(opts);
  if (!existsSync(path)) return { version: 1, artifacts: {} };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: invalid JSON (${err.message})`, { cause: err });
  }
  return validate(raw, path);
}
/** Validate, then write atomically, deterministic and diff-friendly. */
export function writeLock(lock, opts) {
  const path = lockPath(opts);
  const text = `${JSON.stringify(validate(lock, path), sortKeys, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, text);
  return path;
}
export function recordInstall({ kind, name, path }, origin, opts) {
  const lock = readLock(opts);
  lock.artifacts[`${kind}:${name}`] = { ...origin, hash: contentHash(path, kind) };
  writeLock(lock, opts);
}
/** Records an installed plugin under `plugins`; `entry.entries` are the lock keys of its artifacts. */
export function recordPlugin(name, entry, opts) {
  const lock = readLock(opts);
  lock.plugins = { ...lock.plugins, [name]: entry };
  writeLock(lock, opts);
}
export function forgetInstall(key, opts) {
  const lock = readLock(opts);
  if (!Object.hasOwn(lock.artifacts, key)) return;
  delete lock.artifacts[key];
  writeLock(lock, opts);
}
