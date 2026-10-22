/**
 * HU-0001 (ADR 0022, decision 3) — the ownership ledger of `.rulesync/`.
 *
 * Several writers (the user, kj, atril) share one rulesync source. Each owns
 * what it wrote: a per-file feature by its path, an entry of a single-file
 * feature (hooks.json, mcp.jsonc, permissions.jsonc) by its key. The ledger
 * records owner and hash of every owned piece; it is the single source of
 * hashes. An entry with no owner is the user's. The format is a contract,
 * not shared code: atril implements the same one in its own package.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomicSync } from "./atomic-write.js";

export const LEDGER_FILE = join(".rulesync", ".owners.json");
export const LOCK_FILE = join(".rulesync", ".owners.lock");
const VERSION = 1;

export const mcpKey = (server) => `mcp:${server}`;
export const permissionKey = (rule) => `permissions:${rule}`;
export const hookKey = (event, id) => `hooks:${event}:${id}`;

export const hashContent = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;

/** The ledger, or an empty one when absent. A broken or unknown one fails loudly. */
export function readLedger(projectDir) {
  const file = join(projectDir, LEDGER_FILE);
  if (!existsSync(file)) return { version: VERSION, entries: {} };
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`, { cause: err });
  }
  if (ledger?.version !== VERSION || typeof ledger.entries !== "object" || ledger.entries === null) {
    throw new Error(`${file}: version ${ledger?.version} is not supported (expected ${VERSION})`);
  }
  return ledger;
}

/**
 * Read, change and write the ledger under its lock, so two writers never
 * interleave. The write is atomic; a change that throws writes nothing.
 * @param {string} projectDir
 * @param {string} owner - who takes the lock, named to whoever finds it held
 * @param {(ledger: object) => void} change - mutates the ledger in place
 */
export function withLedger(projectDir, owner, change) {
  const lock = join(projectDir, LOCK_FILE);
  let fd;
  try {
    fd = openSync(lock, "wx");
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const holder = readFileSync(lock, "utf8").trim() || "unknown";
    throw new Error(`${lock}: held by ${holder} — another writer is updating the ledger; retry when it ends`, { cause: err });
  }
  try {
    writeSync(fd, owner);
    closeSync(fd);
    fd = undefined;
    const ledger = readLedger(projectDir);
    change(ledger);
    writeJsonAtomicSync(join(projectDir, LEDGER_FILE), ledger);
    return ledger;
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(lock, { force: true });
  }
}

/**
 * "ok" when the content still matches its recorded hash, "edited" when it
 * changed by hand (the writer must stop), "unowned" when no writer recorded it.
 */
export function verifyEntry(ledger, key, content) {
  const entry = ledger.entries[key];
  if (!entry) return "unowned";
  return entry.hash === hashContent(content) ? "ok" : "edited";
}
