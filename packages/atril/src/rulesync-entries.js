/**
 * The hooks and MCP entries of a plugin in the shared `.rulesync/` (ADR 0041). atril merges its own entries into
 * `mcp.json` / `hooks.json` (or the `.jsonc` that wins over them, read with JSON.parse) and owns each one in the
 * ledger: `<file>#<plugin>/<server>` for an MCP server, `<file>#<plugin>/<event>/<sha256 hex>` for a hook handler.
 * User entries and other plugins' entries are never touched; remove undoes exactly what merge wrote.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { hashContent, LEDGER_FILE, OWNER, readLedger, withLedger } from "./ledger.js";
import { isMapping } from "./model.js";

const RULESYNC = ".rulesync";
const EMPTY = { mcp: () => ({ mcpServers: {} }), hooks: () => ({ version: 1, hooks: {} }) };
const SAFE_NAME = /^[^/#\s]+$/;
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const digest = (value) => hashContent(JSON.stringify(value));
const save = ({ path, doc }) => writeAtomic(path, `${JSON.stringify(doc, null, 2)}\n`);
const checkName = (label, name) => {
  if (!SAFE_NAME.test(name) || UNSAFE.has(name)) throw new Error(`${label} "${name}" is not allowed (no "/", "#", spaces, __proto__, constructor or prototype)`);
};

// The file `name` parsed (empty when absent); comments, trailing commas or a non-object stop it, rewriting nothing.
function read(projectDir, name) {
  const path = join(projectDir, RULESYNC, name);
  const exists = existsSync(path);
  let doc = EMPTY[name.split(".")[0]]();
  try { if (exists) doc = JSON.parse(readFileSync(path, "utf8")); } catch (err) {
    throw new Error(`${RULESYNC}/${name}: comments or trailing commas are not supported (${err.message}); atril rewrote nothing`, { cause: err });
  }
  if (!isMapping(doc)) throw new Error(`${RULESYNC}/${name}: must be a JSON object (not an array or null); atril rewrote nothing`);
  return { path, doc, exists };
}

const winner = (projectDir, kind) => [`${kind}.jsonc`, `${kind}.json`].find((name) => existsSync(join(projectDir, RULESYNC, name))) ?? `${kind}.json`;
const owned = (ledger, plugin) => Object.entries(ledger.entries).filter(([key, { owner }]) => owner === OWNER && key.includes(`#${plugin}/`));
const parse = (key) => { const [name, rest] = key.split("#"); return { name, parts: rest.split("/").slice(1) }; };

// Takes what `plugin` wrote out of every file it went to, one handler occurrence per key, and drops its keys. A server the user edited since stays (`kept`; with `strict`, a conflict).
function release(projectDir, ledger, plugin, files, strict) {
  const keys = owned(ledger, plugin);
  const kept = [];
  for (const [key, { hash }] of keys) {
    const { name, parts: [group, handler] } = parse(key);
    const { doc } = files.get(name) ?? files.set(name, read(projectDir, name)).get(name);
    if (!handler && Object.hasOwn(doc.mcpServers ?? {}, group) && digest(doc.mcpServers[group]) !== hash) {
      if (strict) throw new Error(`${RULESYNC}/${name}: "${group}" was edited since atril wrote it; atril will not overwrite it (restore it, or move your change out and remove it)`);
      kept.push(key);
    } else if (!handler) delete doc.mcpServers?.[group];
    else if (doc.hooks?.[group]) {
      const at = doc.hooks[group].findLastIndex((item) => digest(item) === hash);
      if (at >= 0) doc.hooks[group].splice(at, 1);
      if (!doc.hooks[group].length) delete doc.hooks[group];
    }
    delete ledger.entries[key];
  }
  return { removed: keys.map(([key]) => key).filter((key) => !kept.includes(key)), kept };
}

// Every file a merge can write: the ledger and both forms of each source. `undo` puts back their bytes, deleting what was absent.
function snapshot(projectDir) {
  const before = [LEDGER_FILE, ...["mcp", "hooks"].flatMap((kind) => [`${kind}.json`, `${kind}.jsonc`].map((name) => join(RULESYNC, name)))]
    .map((file) => join(projectDir, file)).map((path) => [path, existsSync(path) ? readFileSync(path) : null]);
  return () => before.forEach(([path, bytes]) => (bytes ? writeAtomic(path, bytes) : rmSync(path, { force: true })));
}

/**
 * Merges the canonical entries of `plugin` into `.rulesync/` and owns them in the ledger. Everything is judged
 * before anything is written; a user entry with the same key stops it with nothing changed, and a failed write
 * puts every file back.
 * @param {{ mcp?: { mcpServers?: object }, hooks?: { hooks?: Record<string, object[]> } }} canonical
 * @returns {() => void} undo: puts `.rulesync/` back as it was before this merge
 */
export function mergeEntries(projectDir, plugin, canonical) {
  checkName("plugin name", plugin);
  const undo = snapshot(projectDir);
  try { merge(projectDir, plugin, canonical); } catch (error) { undo(); throw error; }
  return undo;
}

function merge(projectDir, plugin, canonical) {
  withLedger(projectDir, (ledger) => {
    const files = new Map();
    release(projectDir, ledger, plugin, files, true); // a reinstall replaces everything this plugin wrote, in any file
    for (const [kind, wanted] of [["mcp", canonical.mcp?.mcpServers], ["hooks", canonical.hooks?.hooks]]) {
      if (!wanted || !Object.keys(wanted).length) continue;
      const name = winner(projectDir, kind);
      const file = files.get(name) ?? files.set(name, read(projectDir, name)).get(name);
      for (const [entry, value] of Object.entries(wanted)) {
        checkName(kind === "mcp" ? "MCP server" : "hook event", entry);
        if (kind === "mcp") {
          if (Object.hasOwn(file.doc.mcpServers ??= {}, entry)) throw new Error(`${RULESYNC}/${name}: "${entry}" is already an entry; atril will not overwrite it (rename yours or remove it)`);
          file.doc.mcpServers[entry] = value;
          ledger.entries[`${name}#${plugin}/${entry}`] = { owner: OWNER, hash: digest(value) };
        } else {
          const handlers = [...new Map(value.map((handler) => [digest(handler), handler]))];
          file.doc.hooks = { ...file.doc.hooks, [entry]: [...(file.doc.hooks?.[entry] ?? []), ...handlers.map(([, handler]) => handler)] };
          for (const [hash] of handlers) ledger.entries[`${name}#${plugin}/${entry}/${hash.slice(7)}`] = { owner: OWNER, hash };
        }
      }
    }
    [...files.values()].forEach(save);
  });
}

/** Whether `plugin` owns entries in `.rulesync/` now. */
export const hasEntries = (projectDir, plugin) => existsSync(join(projectDir, RULESYNC)) && owned(readLedger(projectDir), plugin).length > 0;

/**
 * Deletes the entries `plugin` owns, from the file each ledger key names, and their ledger keys.
 * @returns {{ removed: string[], kept: string[] }} `kept`: keys of entries the user edited, left in the file
 */
export function removeEntries(projectDir, plugin) {
  if (!hasEntries(projectDir, plugin)) return { removed: [], kept: [] };
  let result;
  withLedger(projectDir, (ledger) => {
    const files = new Map();
    result = release(projectDir, ledger, plugin, files);
    [...files.values()].filter(({ exists }) => exists).forEach(save);
  });
  return result;
}
