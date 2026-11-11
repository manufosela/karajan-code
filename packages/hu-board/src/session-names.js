// KJC-TSK-1483: the name the user gave a Claude Code session (/rename), so its robot in
// kj stage says it. Claude Code keeps it in the session's transcript, in
// ~/.claude*/projects/<dir>/<session id>.jsonl, as a customTitle; the last one wins.
// Read only, the tail of the file only; no name found is null, never an error.
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TAIL_BYTES = 256 * 1024;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TITLE = /"customTitle":("(?:[^"\\]|\\.){1,200}")/g;
// KJC-TSK-1537: an answer of the session names its model ("claude-opus-5-5"); only that shape is read.
const MODEL = /^claude-[a-z0-9-]{1,40}$/;

const list = (dir) => { try { return readdirSync(dir); } catch { return []; } };
const isFile = (file) => { try { return statSync(file).isFile(); } catch { return false; } };

function transcriptOf(home, id) {
  for (const claude of list(home).filter((n) => n.startsWith('.claude'))) {
    const projects = join(home, claude, 'projects');
    const file = list(projects).map((dir) => join(projects, dir, `${id}.jsonl`)).find(isFile);
    if (file) return file;
  }
  return null;
}

function tailOf(file) {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    const buf = Buffer.alloc(Math.min(size, TAIL_BYTES));
    readSync(fd, buf, 0, buf.length, size - buf.length);
    return buf.toString('utf8');
  } finally { closeSync(fd); }
}

/** The last match of `pattern` in the transcript's tail, parsed, or null. */
function lastOf(home, id, pattern) {
  const file = transcriptOf(home, id);
  if (!file) return null;
  try {
    const last = [...tailOf(file).matchAll(pattern)].at(-1);
    return last ? JSON.parse(last[1]).slice(0, 60) : null;
  } catch { return null; }
}

/**
 * KJC-TSK-1537: the model of the last assistant answer in the transcript's tail that names a
 * Claude model, or null. An answer that names none (Claude Code writes "<synthetic>" for its own
 * notices, such as an API error) is skipped on purpose: the session still runs on its model.
 */
function lastModel(home, id) {
  const file = transcriptOf(home, id);
  if (!file) return null;
  let tail;
  try { tail = tailOf(file); } catch { return null; } // gone or unreadable since it was found
  let model = null;
  for (const line of tail.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const record = JSON.parse(line);
      const said = record.type === 'assistant' ? record.message?.model : null;
      if (typeof said === 'string' && MODEL.test(said)) model = said;
    } catch { /* the first line of the tail may be cut */ }
  }
  return model;
}

/**
 * `nameOf(sessionId)`: the session's name or null; KJC-TSK-1537: `modelOf(sessionId)`, the model of
 * its last answer or null. Both kept for `ttlMs` so a rename or a model switch shows soon.
 */
export function createSessionNames({ home = homedir(), now = Date.now, ttlMs = 60_000 } = {}) {
  const known = new Map();
  const read = (id) => {
    if (typeof id !== 'string' || !SESSION_ID.test(id)) return { name: null, model: null };
    const hit = known.get(id);
    if (hit && now() - hit.at < ttlMs) return hit;
    const fresh = { name: lastOf(home, id, TITLE), model: lastModel(home, id), at: now() };
    known.set(id, fresh);
    return fresh;
  };
  return { nameOf: (id) => read(id).name, modelOf: (id) => read(id).model };
}

const shared = createSessionNames();
export const sessionName = (id) => shared.nameOf(id);
export const sessionModel = (id) => shared.modelOf(id);

/** A host's activity with its session's name and model (when known); anyone else's, untouched. */
export function withSessionName(ev, nameOf = sessionName, modelOf = sessionModel) {
  if (ev.role !== 'host' || !ev.id) return ev;
  const model = modelOf(ev.id);
  return { ...ev, name: nameOf(ev.id), ...(model ? { model } : {}) };
}
