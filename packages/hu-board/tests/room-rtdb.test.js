// KJC-TSK-1575 (ADR 0056): the room through the REST API of Realtime Database. A listened path
// comes as server-sent events; the board keeps the tree they describe.
import { describe, expect, it } from 'vitest';

import { applyEvent, createRtdb, parseSse } from '../src/room/rtdb.js';

describe('listen', () => {
  const session = { room: 'a~b', idToken: async () => 'id' };

  it('says why the room refused a listen, and tries again', async () => {
    const warned = [];
    const leaving = new AbortController();
    let calls = 0;
    const fetch = async () => { calls += 1; if (calls === 2) leaving.abort(); return { ok: false, status: 401, body: null }; };
    const rtdb = createRtdb(session, { fetch, log: { warn: (m) => warned.push(m) }, retryMs: 1 });
    await rtdb.listen('presence', () => {}, { signal: leaving.signal });
    expect(warned[0]).toMatch(/presence: the room refused to listen \(HTTP 401\)/);
    expect(calls).toBe(2);
  });

  it('hears the tree the stream describes', async () => {
    const leaving = new AbortController();
    const chunks = [new TextEncoder().encode('event: put\ndata: {"path":"/","data":{"manufosela":1}}\n\n')];
    const fetch = async () => ({ ok: true, status: 200, body: chunks });
    const heard = [];
    const rtdb = createRtdb(session, { fetch, log: { warn: () => leaving.abort() }, retryMs: 1 });
    await rtdb.listen('presence', (tree) => { heard.push(tree); leaving.abort(); }, { signal: leaving.signal });
    expect(heard).toEqual([{ manufosela: 1 }]);
  });
});

describe('parseSse', () => {
  it('splits whole events and keeps an unfinished one for the next chunk', () => {
    const { events, rest } = parseSse('event: put\ndata: {"path":"/","data":{"a":1}}\n\nevent: keep-alive\ndata: null\n\nevent: pa');
    expect(events).toEqual([{ event: 'put', data: { path: '/', data: { a: 1 } } }, { event: 'keep-alive', data: null }]);
    expect(rest).toBe('event: pa');
  });

  it('skips an event whose data is not JSON', () => {
    expect(parseSse('event: put\ndata: {broken\n\n').events).toEqual([]);
  });
});

describe('applyEvent', () => {
  it('puts the whole tree, a child, or removes it, and patches children', () => {
    let tree = applyEvent({}, { event: 'put', data: { path: '/', data: { a: 1, b: 2 } } });
    expect(tree).toEqual({ a: 1, b: 2 });
    tree = applyEvent(tree, { event: 'put', data: { path: '/c', data: 3 } });
    tree = applyEvent(tree, { event: 'put', data: { path: '/a', data: null } });
    tree = applyEvent(tree, { event: 'patch', data: { path: '/', data: { b: 5, d: 4 } } });
    expect(tree).toEqual({ b: 5, c: 3, d: 4 });
    expect(applyEvent(tree, { event: 'put', data: { path: '/', data: null } })).toEqual({});
  });

  it('puts and removes at any depth, dropping a branch left empty', () => {
    let tree = applyEvent({}, { event: 'put', data: { path: '/jorgecasar/-N1', data: 'offer' } });
    tree = applyEvent(tree, { event: 'patch', data: { path: '/jorgecasar', data: { '-N2': 'candidate' } } });
    expect(tree).toEqual({ jorgecasar: { '-N1': 'offer', '-N2': 'candidate' } });
    tree = applyEvent(tree, { event: 'put', data: { path: '/jorgecasar/-N1', data: null } });
    tree = applyEvent(tree, { event: 'put', data: { path: '/jorgecasar/-N2', data: null } });
    expect(tree).toEqual({});
  });

  it('leaves the tree alone for any other event', () => {
    const tree = { a: 1 };
    expect(applyEvent(tree, { event: 'keep-alive', data: null })).toBe(tree);
  });
});
