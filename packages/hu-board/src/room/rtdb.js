/**
 * KJC-TSK-1567 (ADR 0056): the room's Realtime Database through its REST API, with the session's
 * id token: writes, and a path listened to through its server-sent events stream. No Firebase SDK.
 */
import { ROOM_DB } from './session.js';

const RETRY_MS = 3000;

/** The whole events of `text` (server-sent events) and what is left of an unfinished one. */
export function parseSse(text) {
  const blocks = text.split('\n\n');
  const rest = blocks.pop();
  const events = blocks.flatMap((block) => {
    const field = (name) => block.split('\n').find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim();
    try { return [{ event: field('event'), data: JSON.parse(field('data') ?? 'null') }]; } catch { return []; }
  });
  return { events, rest };
}

const isEmpty = (value) => value === null || value === undefined || (typeof value === 'object' && Object.keys(value).length === 0);

/** `tree` with `value` at `keys`; a null or emptied branch goes, as in Realtime Database. */
function setIn(tree, keys, value) {
  if (!keys.length) return value ?? {};
  const [key, ...rest] = keys;
  const base = tree && typeof tree === 'object' ? tree : {};
  const child = rest.length ? setIn(base[key], rest, value) : value;
  const others = Object.fromEntries(Object.entries(base).filter(([k]) => k !== key));
  return isEmpty(child) ? others : { ...others, [key]: child };
}

/** The listened tree after a put or patch event at `data.path`, at any depth. */
export function applyEvent(tree, { event, data }) {
  if (event !== 'put' && event !== 'patch') return tree;
  const keys = data.path.split('/').filter(Boolean);
  if (event === 'put') return setIn(tree, keys, data.data);
  return Object.entries(data.data ?? {}).reduce((next, [k, v]) => setIn(next, [...keys, k], v), tree);
}

/** Plays the server-sent events of `res` into `onEvent`; a revoked or cancelled listen throws. */
async function readStream(res, onEvent) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    const { events, rest } = parseSse(buffer + decoder.decode(chunk, { stream: true }));
    buffer = rest;
    for (const e of events) {
      if (e.event === 'auth_revoked' || e.event === 'cancel') throw new Error(e.event);
      onEvent(e);
    }
  }
}

/** Writes and listens under `rooms/<room>` with `session`'s id token. */
export function createRtdb(session, { fetch = globalThis.fetch, log = console, retryMs = RETRY_MS } = {}) {
  const url = async (path) => `${ROOM_DB}/rooms/${encodeURIComponent(session.room)}/${path}.json?auth=${await session.idToken()}`;
  const send = async (method, path, value) => {
    const res = await fetch(await url(path), { method, body: value === undefined ? undefined : JSON.stringify(value) });
    if (!res.ok) throw new Error(`the room refused ${method} ${path} (HTTP ${res.status})`);
    return res.json();
  };
  return {
    put: (path, value) => send('PUT', path, value),
    push: (path, value) => send('POST', path, value),
    remove: (path) => send('DELETE', path),
    /** Calls `onTree(tree)` with the tree at `path` on every change, until `signal` aborts; reconnects. */
    async listen(path, onTree, { signal } = {}) {
      while (!signal?.aborted) {
        let tree = {};
        const onEvent = (e) => {
          const next = applyEvent(tree, e);
          if (next === tree) return;
          tree = next;
          onTree(tree);
        };
        try {
          const res = await fetch(await url(path), { headers: { Accept: 'text/event-stream' }, signal });
          if (!res.ok) throw new Error(`the room refused to listen (HTTP ${res.status})`);
          await readStream(res, onEvent);
        } catch (err) {
          if (signal?.aborted) return;
          log.warn(`[room] ${path}: ${err.message}; listening again`);
        }
        await new Promise((r) => setTimeout(r, retryMs));
      }
    },
  };
}
