/**
 * KJC-TSK-1477 (owner's decision, 9-nov): what kj itself writes into a lane is never the lane's
 * work. Caches, the index and traces are regenerable and go with the lane; the governance record
 * (gate decisions, review verdicts, handoffs) is archived in the main checkout before the lane
 * goes; a pending handoff keeps the lane. The lists are literal: anything else still counts.
 */
import fs from "node:fs";
import path from "node:path";

// HU-3092: the lane's index and what rides along it (-wal, -shm, .bootstrap, .embed-schema).
const RAG_STATE = /^\.karajan\/rag\.db([.-]|$)/;
const DISPOSABLE = [".karajan/board-cache.json", ".karajan/traces/", ".kj/run.log"];
export const ARCHIVED = [".karajan/policy-decisions.jsonl", ".karajan/policy-exceptions.jsonl", ".karajan/reviews/", ".karajan/handoffs/"];
const HANDOFF_FILE = /^[0-9a-f]{8}\.json$/;

const listed = (rel, entry) => (entry.endsWith("/") ? rel.startsWith(entry) : rel === entry);

/** A lane-relative path (git's `/` separators) kj wrote as its own state. */
export const isKjState = (rel) => RAG_STATE.test(rel) || [...DISPOSABLE, ...ARCHIVED].some((entry) => listed(rel, entry));

/** Handoffs of the lane still waiting for the user; one that cannot be read counts as waiting. */
export function pendingHandoffs(lanePath) {
  const dir = path.join(lanePath, ".karajan", "handoffs");
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  return names.filter((name) => HANDOFF_FILE.test(name)).filter((name) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))?.status !== "done"; } catch { return true; }
  }).length;
}

/** Copies the lane's governance record to `dest`, keeping its lane-relative paths. */
export function archiveKjState(lanePath, dest) {
  for (const entry of ARCHIVED.filter((e) => fs.existsSync(path.join(lanePath, e)))) {
    const to = path.join(dest, entry);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(path.join(lanePath, entry), to, { recursive: true });
  }
}
