// KJC-TSK-1571 (ADR 0056, point 3): the boards of a room link to each other through its signals
// (each read once and deleted). Two boards in memory, a fake WebRTC.
import { describe, expect, it } from 'vitest';

import { createMesh, offers } from '../src/room/mesh.js';
import { applyEvent } from '../src/room/rtdb.js';

/** A room database in memory: writes land in one tree and every listener hears its path. */
function memoryRoom() {
  let tree = {};
  let n = 0;
  const listeners = [];
  const at = (path) => path.split('/').reduce((t, k) => t?.[k], tree) ?? {};
  const write = async (path, value) => {
    tree = applyEvent(tree, { event: 'put', data: { path: `/${path}`, data: value } });
    for (const { path: p, onTree } of listeners) if (path.startsWith(p)) onTree(at(p));
  };
  const rtdb = { put: write, push: (path, value) => write(`${path}/-N${(n += 1)}`, value), remove: (path) => write(path, null), listen: (path, onTree) => listeners.push({ path, onTree }) };
  return { rtdb, tree: () => tree };
}

/** A fake WebRTC where two peers that swapped descriptions get a channel joined to each other's. */
const fakeRtc = (wires) => ({
  connect({ onDescription, onChannel }) {
    const peer = { closed: false, addCandidate: () => {}, close: () => { peer.closed = true; } };
    const makeChannel = () => { const c = { open: false, isOpen: () => c.open, onMessage: (fn) => { c.deliver = fn; }, send: (t) => c.other?.deliver?.(t) }; return c; };
    peer.openChannel = () => { peer.channel = makeChannel(); wires.push(peer); queueMicrotask(() => onDescription(`offer-of-${wires.length}`, 'offer')); return peer.channel; };
    peer.setRemote = (sdp, type) => {
      if (type !== 'offer') return;
      const offerer = wires[Number(sdp.split('-').pop()) - 1];
      peer.channel = makeChannel();
      [peer.channel.other, offerer.channel.other] = [offerer.channel, peer.channel];
      offerer.channel.open = peer.channel.open = true;
      onChannel(peer.channel);
      onDescription('answer', 'answer');
    };
    return peer;
  },
});

describe('createMesh', () => {
  it('opens a channel between two boards through the room and carries messages both ways', async () => {
    const room = memoryRoom();
    const wires = [];
    const rtc = fakeRtc(wires);
    const heard = { manufosela: [], jorgecasar: [] };
    const mesh = (login) => createMesh({ session: { login }, rtdb: room.rtdb, rtc, onMessage: (from, msg) => heard[login].push([from, msg]) });
    const mine = mesh('manufosela');
    const theirs = mesh('jorgecasar');
    mine.setPeers(['jorgecasar']);
    theirs.setPeers(['manufosela']);
    await new Promise((r) => setTimeout(r, 0));
    // Only the smaller login offers (jorgecasar), and the channel opens on both sides.
    expect([offers('jorgecasar', 'manufosela'), offers('manufosela', 'jorgecasar'), wires.length]).toEqual([true, false, 1]);
    expect([theirs.open(), mine.open()]).toEqual([['manufosela'], ['jorgecasar']]);
    mine.send({ role: 'coder' });
    theirs.send({ role: 'reviewer' });
    expect(heard).toEqual({ jorgecasar: [['manufosela', { role: 'coder' }]], manufosela: [['jorgecasar', { role: 'reviewer' }]] });
    expect(room.tree().signals ?? {}).toEqual({});
    theirs.setPeers([]); // the peer left the room: its link closes
    expect([wires[0].closed, theirs.open()]).toEqual([true, []]);
  });

  /** A WebRTC that only records what it is told, and a signal from `from` to `to` through `room`. */
  const recording = (done) => ({ links: 0, connect() { this.links += 1; return { setRemote: (sdp) => done.push(sdp), addCandidate: (c) => done.push(c), close: () => {}, openChannel: () => ({ onMessage: () => {} }) }; } });
  const say = (room, to, from, message) => room.rtdb.push(`signals/${to}/${from}`, JSON.stringify(message));

  it('keeps the signals of a sender not in the room waiting, and plays them once it is in', async () => {
    const room = memoryRoom();
    const done = [];
    const rtc = recording(done);
    const mesh = createMesh({ session: { login: 'zoe' }, rtdb: room.rtdb, rtc, onMessage: () => {} });
    await say(room, 'zoe', 'ana', { kind: 'description', sdp: 'o', type: 'offer' });
    expect(rtc.links).toBe(0);
    mesh.setPeers(['ana']);
    expect([rtc.links, done]).toEqual([1, ['o']]);
    mesh.setPeers([]); // ana left: a late signal of hers waits again
    await say(room, 'zoe', 'ana', { kind: 'candidate', candidate: 'c', mid: '0' });
    expect(rtc.links).toBe(1);
  });

  it('deletes again a played signal the room refused to delete', async () => {
    const room = memoryRoom();
    const remove = room.rtdb.remove;
    let refuse = 1;
    room.rtdb.remove = async (path) => { if (refuse-- > 0) throw new Error('offline'); return remove(path); };
    createMesh({ session: { login: 'zoe' }, rtdb: room.rtdb, rtc: recording([]), onMessage: () => {} }).setPeers(['ana']);
    await say(room, 'zoe', 'ana', { kind: 'description', sdp: 'o', type: 'offer' });
    await say(room, 'zoe', 'bob', { kind: 'candidate', candidate: 'c' }); // any later news retries
    expect(room.tree().signals.zoe.ana).toBeUndefined();
  });

  it('plays only the newest negotiation, a candidate waiting for its description', async () => {
    const room = memoryRoom();
    const done = [];
    const mesh = createMesh({ session: { login: 'zoe' }, rtdb: room.rtdb, rtc: recording(done), onMessage: () => {} });
    for (const m of [{ kind: 'description', sdp: 'old', type: 'offer' }, { kind: 'candidate', candidate: 'c0' }, { kind: 'description', sdp: 'o', type: 'offer' }]) await say(room, 'zoe', 'ana', m);
    mesh.setPeers(['ana']);
    expect(done).toEqual(['o']);
    await say(room, 'zoe', 'ana', { kind: 'description', sdp: 'o2', type: 'offer' }); // ana came back: a new link
    expect(done).toEqual(['o', 'o2']);
  });});
