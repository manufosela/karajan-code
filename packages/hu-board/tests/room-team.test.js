// KJC-TSK-1577 (ADR 0056, point 3): once in a room, the board runs its mesh: the own agents go
// out with the own avatar, the teammates' come in as lanes of the factory and as live events.
import { describe, expect, it } from 'vitest';

import { runTeam, teamOfDir } from '../src/room/team.js';

const start = { type: 'agent-activity', phase: 'start', agent: 'codex', role: 'coder', id: 's1', at: 't' };

/** A room with one folder, a fake mesh and a fake watch of its lanes. */
function setup() {
  const sent = [];
  const relayed = [];
  const mesh = { peers: [], linked: [], open: () => mesh.linked, setPeers(p) { mesh.peers = p; }, send: (m) => sent.push(m), close() { mesh.closed = true; } };
  let deliver;
  let feed;
  const team = runTeam({ session: { login: 'manufosela' }, rtdb: {}, dirs: ['/w/kc'] }, {
    meshOf: ({ onMessage }) => { deliver = onMessage; return mesh; },
    relayOf: () => ({ publish: (m) => relayed.push(m) }),
    watch: (_dir, send) => { feed = send; return () => {}; },
    lanesOf: () => [{ lane: 'kj-stage', working: [{ agent: 'claude', role: 'host', id: 'h1', at: 't' }] }],
    avatar: () => ({ emblem: 'fox', color: null }),
    repeatMs: 0,
  });
  return { team, mesh, sent, relayed, deliver: (...a) => deliver(...a), feed: (e) => feed(e) };
}

describe('runTeam', () => {
  it('sends the own agents\' activity with the own avatar, and nothing else', () => {
    const { team, sent, feed } = setup();
    feed({ ...start, lane: 'kj-stage', prompt: 'secret' });
    feed({ type: 'sentinel-deny', lane: 'kj-stage' });
    expect(sent).toEqual([{ ...start, lane: 'kj-stage', avatar: { emblem: 'fox', color: null } }]);
    team.stop();
  });

  it('relays through the room only while a live peer has no open channel (KJC-TSK-1568)', () => {
    const { team, mesh, relayed, feed } = setup();
    team.setPeers(['jorgecasar']);
    feed({ ...start, lane: 'a' });
    mesh.linked = ['jorgecasar'];
    feed({ ...start, lane: 'b' });
    expect(relayed.map((m) => m.lane)).toEqual(['a']);
    team.stop();
  });

  it('says again who works here, for a teammate who came in later', () => {
    const { team, sent } = setup();
    team.repeat();
    expect(sent).toEqual([expect.objectContaining({ agent: 'claude', role: 'host', phase: 'start', lane: 'kj-stage' })]);
    team.stop();
  });

  it('brings a teammate\'s agents in as lanes of the factory and as live events, found by folder', () => {
    const { team, deliver } = setup();
    const heard = [];
    teamOfDir('/w/kc').listen((e) => heard.push(e));
    deliver('jorgecasar', { ...start, lane: 'x' });
    deliver('jorgecasar', { type: 'nonsense' });
    expect(heard).toEqual([expect.objectContaining({ lane: 'x@jorgecasar', owner: 'jorgecasar' })]);
    expect(team.lanes().map((l) => l.lane)).toEqual(['x@jorgecasar']);
    team.stop();
    expect(teamOfDir('/w/kc')).toBeNull();
  });

  it('links to the live peers and forgets the agents of one who left', () => {
    const { team, mesh, deliver } = setup();
    team.setPeers(['jorgecasar']);
    deliver('jorgecasar', { ...start, lane: 'x' });
    team.setPeers([]);
    expect([mesh.peers, team.lanes()]).toEqual([[], []]);
    team.stop();
    expect(mesh.closed).toBe(true);
  });
});
