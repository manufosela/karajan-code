/**
 * HU-0001 (ADR 0022, decision 3) — the ownership ledger of `.rulesync/`. The
 * user, kj and atril share one rulesync source; each owns what it wrote (a
 * per-file feature keyed by its path relative to `.rulesync/`, e.g.
 * `rules/karajan.md`, or `rules/karajan.md#<block>` for a writer's managed
 * block; an entry of hooks/mcp/permissions by key), and the ledger is the
 * single source of their hashes. No entry means the user's, unless a writer
 * finds its marker there (it claims it, once); an entry released to the user
 * (HU-0003) is owned by "user", so no writer claims it again. The
 * format is a contract atril implements in its own package: hashed entries are
 * serialized canonically (JSON, keys sorted) by every writer.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeJsonAtomicSync } from "./atomic-write.js";

export const LEDGER_FILE = join(".rulesync", ".owners.json");
export const LOCK_FILE = join(".rulesync", ".owners.lock");
export const LEDGER_VERSION = 1;
export const USER_OWNER = "user";
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

export const mcpKey = (server) => `mcp:${server}`;
export const permissionKey = (rule) => `permissions:${rule}`;
export function hookKey(event, id) {
  if (event.includes(":")) throw new Error(`hook event "${event}" contains ":", which would make its ledger key ambiguous`);
  return `hooks:${event}:${id}`;
}

export const hashContent = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;

function validate(file, ledger) {
  if (ledger?.version !== LEDGER_VERSION) {
    throw new Error(`${file}: version ${ledger?.version} is not supported (expected ${LEDGER_VERSION})`);
  }
  if (typeof ledger.entries !== "object" || ledger.entries === null || Array.isArray(ledger.entries)) {
    throw new Error(`${file}: entries must be an object of key → { owner, hash }`);
  }
  for (const [key, entry] of Object.entries(ledger.entries)) {
    if (typeof entry?.owner !== "string" || !entry.owner || !HASH_RE.test(entry.hash)) {
      throw new Error(`${file}: entry "${key}" needs a non-empty owner and a sha256:<hex> hash`);
    }
  }
}

/** The ledger, or an empty one when absent. A broken, malformed or unknown one fails loudly. */
export function readLedger(projectDir) {
  const file = join(projectDir, LEDGER_FILE);
  if (!existsSync(file)) return { version: LEDGER_VERSION, entries: {} };
  let ledger;
  try { ledger = JSON.parse(readFileSync(file, "utf8")); } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`, { cause: err });
  }
  validate(file, ledger);
  return ledger;
}

function takeLock(lock, owner) {
  try {
    writeFileSync(lock, `${owner} ${process.pid}`, { flag: "wx" });
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`${dirname(lock)}: .rulesync/ is missing (run rulesync init)`, { cause: err });
    if (err.code !== "EEXIST") throw err;
    let holder = "unknown";
    try { holder = readFileSync(lock, "utf8").trim() || holder; } catch { /* released meanwhile */ }
    throw new Error(`${lock}: held by ${holder} — another writer is updating the ledger; retry when it ends `
      + `(if no writer is running, delete ${lock})`, { cause: err });
  }
}

/**
 * Read, change and write the ledger under its lock, so two writers never
 * interleave. The write is atomic; a change that throws writes nothing. A
 * lock left by a crashed writer is never stolen: the error says how to clear it.
 * @param {string} projectDir
 * @param {string} owner - who takes the lock, named to whoever finds it held
 * @param {(ledger: object) => void} change - mutates the ledger in place
 */
export function withLedger(projectDir, owner, change) {
  if (typeof owner !== "string" || !owner) throw new Error("withLedger: owner must be a non-empty string");
  const lock = join(projectDir, LOCK_FILE);
  takeLock(lock, owner);
  try {
    const ledger = readLedger(projectDir);
    change(ledger);
    validate(join(projectDir, LEDGER_FILE), ledger);
    writeJsonAtomicSync(join(projectDir, LEDGER_FILE), ledger);
    return ledger;
  } finally {
    rmSync(lock, { force: true });
  }
}

/**
 * "ok" when the content still matches its recorded hash, "edited" when it
 * changed by hand (the writer must stop), "unowned" when no writer recorded it.
 */
export function verifyEntry(ledger, key, content) {
  if (!Object.hasOwn(ledger.entries, key)) return "unowned";
  return ledger.entries[key].hash === hashContent(content) ? "ok" : "edited";
}
