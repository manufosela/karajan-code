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

function lastTitle(home, id) {
  const file = transcriptOf(home, id);
  if (!file) return null;
  try {
    const last = [...tailOf(file).matchAll(TITLE)].at(-1);
    return last ? JSON.parse(last[1]).slice(0, 60) : null;
  } catch { return null; }
}

/** `nameOf(sessionId)`: the session's name or null, kept for `ttlMs` so a rename shows soon. */
export function createSessionNames({ home = homedir(), now = Date.now, ttlMs = 60_000 } = {}) {
  const known = new Map();
  return {
    nameOf(id) {
      if (typeof id !== 'string' || !SESSION_ID.test(id)) return null;
      const hit = known.get(id);
      if (hit && now() - hit.at < ttlMs) return hit.name;
      const name = lastTitle(home, id);
      known.set(id, { name, at: now() });
      return name;
    },
  };
}

const shared = createSessionNames();
export const sessionName = (id) => shared.nameOf(id);

/** A host's activity with its session's name; anyone else's, untouched. */
export const withSessionName = (ev, nameOf = sessionName) =>
  (ev.role === 'host' && ev.id ? { ...ev, name: nameOf(ev.id) } : ev);
