/**
 * The ownership ledger of `.rulesync/` (ADR 0022, decision 3), atril's own implementation of the
 * contract it shares with kj and the user (ADR 0021, decision 11: no code shared with the core).
 * `.rulesync/.owners.json` is { version: 1, entries: { "<posix path under .rulesync>[#block]":
 * { owner, hash: "sha256:<hex>" } } }, changed only under `.rulesync/.owners.lock` and written
 * atomically, in the same layout kj writes it, so the two writers never churn the file.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { isMapping } from "./model.js";

export const LEDGER_FILE = join(".rulesync", ".owners.json");
export const LOCK_FILE = join(".rulesync", ".owners.lock");
export const OWNER = "atril";
export const USER_OWNER = "user";
const VERSION = 1;
const HASH = /^sha256:[0-9a-f]{64}$/;

export const hashContent = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;

function validate(file, ledger) {
  if (ledger?.version !== VERSION) throw new Error(`${file}: version ${ledger?.version} is not supported (expected ${VERSION})`);
  if (!isMapping(ledger.entries)) throw new Error(`${file}: entries must be an object of key to { owner, hash }`);
  for (const [key, entry] of Object.entries(ledger.entries)) {
    if (typeof entry?.owner !== "string" || !entry.owner || !HASH.test(entry.hash)) {
      throw new Error(`${file}: entry "${key}" needs a non-empty owner and a sha256:<hex> hash`);
    }
  }
}

/** The ledger, or an empty one when absent; a broken, malformed or unknown one fails loudly. */
export function readLedger(projectDir) {
  const file = join(projectDir, LEDGER_FILE);
  if (!existsSync(file)) return { version: VERSION, entries: {} };
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`, { cause: err });
  }
  validate(file, ledger);
  return ledger;
}

function takeLock(lock) {
  try {
    writeFileSync(lock, `${OWNER} ${process.pid}`, { flag: "wx" });
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`${lock}: .rulesync/ is missing (run rulesync init)`, { cause: err });
    if (err.code !== "EEXIST") throw err;
    let holder = "unknown";
    try { holder = readFileSync(lock, "utf8").trim() || holder; } catch { /* released meanwhile */ }
    throw new Error(`${lock}: held by ${holder}, another writer is updating the ledger; retry when it ends `
      + `(if no writer is running, delete ${lock})`, { cause: err });
  }
}

/**
 * Read, change and write the ledger under its lock. A change that throws, or leaves an entry
 * malformed, writes nothing; a lock left by a crashed writer is never stolen.
 * @param {string} projectDir
 * @param {(ledger: object) => void} change - mutates the ledger in place
 */
export function withLedger(projectDir, change) {
  const lock = join(projectDir, LOCK_FILE);
  takeLock(lock);
  try {
    const ledger = readLedger(projectDir);
    change(ledger);
    validate(join(projectDir, LEDGER_FILE), ledger);
    writeAtomic(join(projectDir, LEDGER_FILE), JSON.stringify(ledger, null, 2));
    return ledger;
  } finally {
    rmSync(lock, { force: true });
  }
}
