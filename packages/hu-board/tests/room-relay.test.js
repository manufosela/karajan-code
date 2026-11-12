// KJC-TSK-1568 (ADR 0056, point 5): a board that cannot open a channel with a peer still reaches
// it through the room: its latest messages, numbered, under relay/<login>, read once by those who
// do not hear it directly.
import { describe, expect, it } from 'vitest';

import { createRelay } from '../src/room/relay.js';

/** A room database in memory with the relay tree and its listeners. */
function memoryRoom() {
  const tree = {};
  const listeners = [];
  const rtdb = {
    put: async (path, value) => { tree[path.split('/')[1]] = value; for (const fn of listeners) fn({ ...tree }); },
    listen: (_path, onTree) => listeners.push(onTree),
  };
  return { rtdb, tree };
}

describe('createRelay', () => {
  it('carries messages to a peer that does not hear the sender directly, each once', async () => {
    const room = memoryRoom();
    const heard = [];
    const direct = new Set();
    createRelay({ session: { login: 'zoe' }, rtdb: room.rtdb, onMessage: (from, m) => heard.push([from, m]), hearsDirectly: (from) => direct.has(from), everyMs: 0 });
    const ana = createRelay({ session: { login: 'ana' }, rtdb: room.rtdb, onMessage: () => {}, hearsDirectly: () => false, everyMs: 0 });
    await ana.publish({ role: 'coder' });
    await ana.publish({ role: 'reviewer' });
    expect(heard).toEqual([['ana', { role: 'coder' }], ['ana', { role: 'reviewer' }]]);
    direct.add('ana');
    await ana.publish({ role: 'host' });
    expect(heard).toHaveLength(2); // heard directly now: the relay is not played
  });

  it('hears a peer that started again, numbering from 1', async () => {
    const room = memoryRoom();
    const heard = [];
    createRelay({ session: { login: 'zoe' }, rtdb: room.rtdb, onMessage: (_f, m) => heard.push(m.i), hearsDirectly: () => false, everyMs: 0 });
    const first = createRelay({ session: { login: 'ana' }, rtdb: room.rtdb, onMessage: () => {}, hearsDirectly: () => false, everyMs: 0 });
    await first.publish({ i: 1 });
    await first.publish({ i: 2 });
    const again = createRelay({ session: { login: 'ana' }, rtdb: room.rtdb, onMessage: () => {}, hearsDirectly: () => false, everyMs: 0 });
    await again.publish({ i: 3 });
    expect(heard).toEqual([1, 2, 3]);
  });

  it('keeps only the last messages, as one string under the room\'s size limit', async () => {
    const room = memoryRoom();
    const ana = createRelay({ session: { login: 'ana' }, rtdb: room.rtdb, onMessage: () => {}, hearsDirectly: () => false, everyMs: 0, keep: 3 });
    for (let i = 0; i < 5; i++) await ana.publish({ i });
    const kept = JSON.parse(room.tree.ana);
    expect(kept.map((e) => e.message.i)).toEqual([2, 3, 4]);
    expect(room.tree.ana.length).toBeLessThan(20000);
  });

  it('ignores its own relay and anything that is not a list', async () => {
    const room = memoryRoom();
    const heard = [];
    const ana = createRelay({ session: { login: 'ana' }, rtdb: room.rtdb, onMessage: (from) => heard.push(from), hearsDirectly: () => false, everyMs: 0 });
    await ana.publish({ i: 1 });
    await room.rtdb.put('relay/bob', '{broken');
    expect(heard).toEqual([]);
  });
});
