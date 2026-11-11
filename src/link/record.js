/** HU-3799: the reader's record of one thread: cursor, and per message id its edit time and body SHA-256. Never the body. */
import * as nodeFs from "node:fs";
import { dirname, join } from "node:path";

export class RecordError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new RecordError(code, message);
};
const text = (v) => typeof v === "string" && v.length > 0;

/** The path comes from a validated key (kind and positive integer), never from a message. */
export function recordPath(root, thread) {
  const { kind, number } = thread ?? {};
  if (typeof kind !== "string" || !/^[a-z][a-z-]{0,19}$/.test(kind) || !Number.isSafeInteger(number) || number < 1) {
    fail("bad_thread", "a thread key is a lowercase kind and a positive integer");
  }
  return join(root, ".karajan", "link", `${kind}-${number}.json`);
}

const shape = (raw) => {
  const seen = raw?.seen;
  if (!raw || (raw.cursor !== null && !text(raw.cursor)) || !seen || typeof seen !== "object" || Array.isArray(seen)) fail("corrupt_record", "wrong shape");
  const entries = Object.entries(seen).map(([id, e]) => (text(e?.updatedAt) && text(e?.hash) ? [id, { updatedAt: e.updatedAt, hash: e.hash }] : fail("corrupt_record", "wrong entry")));
  return { cursor: raw.cursor, seen: Object.fromEntries(entries) };
};

/** An absent file is a new record; a corrupt one is an error, never a silent reset. */
export function loadRecord(root, thread, { fs = nodeFs } = {}) {
  const file = recordPath(root, thread);
  if (!fs.existsSync(file)) return { cursor: null, seen: {} };
  try {
    return shape(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    throw new RecordError("corrupt_record", `${file}: ${error instanceof RecordError ? error.message : "not valid JSON"}`);
  }
}

/** Temporary file in the same directory, then rename: a crash leaves the old record whole. */
export function saveRecord(root, thread, record, { fs = nodeFs } = {}) {
  const file = recordPath(root, thread);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(dirname(file), { recursive: true });
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(shape(record))}\n`);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

export const markRead = (record, result) => ({ cursor: result.cursor, seen: { ...record.seen, ...result.seen } });
