// KJC-TSK-1573 (ADR 0056): at start the board enters the room of each repository it shows, once
// per repository, and keeps its presence there; KJ_ROOM=off keeps it out of every room.
import { describe, expect, it } from 'vitest';

import { startRooms } from '../src/room/rooms.js';

const quiet = { log: () => {}, warn: () => {} };

/** Fakes of the session, the database and the presence; `peersOf` says who each room sees. */
function fakes(repos, peersOf = {}) {
  const opened = [];
  const open = async (dir) => {
    opened.push(dir);
    return repos[dir] ? { login: 'manufosela', room: repos[dir].replace('/', '~'), repo: repos[dir], idToken: async () => 'id' } : null;
  };
  const presence = (session, _rtdb, onPeers) => { onPeers(peersOf[session.repo] ?? []); return async () => {}; };
  const team = () => ({ peers: [], setPeers(p) { this.peers = p; }, stop() {} });
  return { opened, deps: { open, rtdbOf: () => ({}), presence, team, log: quiet } };
}

describe('startRooms', () => {
  it('enters each repository\'s room once, skipping folders off GitHub or refused', async () => {
    const { opened, deps } = fakes({ '/w/kc': 'manufosela/karajan-code', '/w/kc2': 'manufosela/karajan-code', '/w/gr': 'manufosela/grebla' });
    const rooms = await startRooms({ ...deps, targets: () => ['/w/kc', '/w/kc2', '/w/gr', '/w/off'], env: {} });
    expect(opened).toEqual(['/w/kc', '/w/kc2', '/w/gr', '/w/off']);
    expect([...rooms.byRepo.keys()]).toEqual(['manufosela/karajan-code', 'manufosela/grebla']);
  });

  it('keeps who is live in each room', async () => {
    const { deps } = fakes({ '/w/kc': 'manufosela/karajan-code' }, { 'manufosela/karajan-code': ['jorgecasar'] });
    const rooms = await startRooms({ ...deps, targets: () => ['/w/kc'], env: {} });
    const room = rooms.byRepo.get('manufosela/karajan-code');
    expect([room.peers, room.team.peers]).toEqual([['jorgecasar'], ['jorgecasar']]);
  });

  it('enters no real room under the test runner unless asked', async () => {
    const { opened, deps } = fakes({ '/w/kc': 'manufosela/karajan-code' });
    await startRooms({ ...deps, targets: () => ['/w/kc'], env: { VITEST: 'true' } });
    expect(opened).toEqual([]);
    await startRooms({ ...deps, targets: () => ['/w/kc'], env: { VITEST: 'true', KJ_ROOM: 'on' } });
    expect(opened).toEqual(['/w/kc']);
  });

  it('enters no room with KJ_ROOM=off', async () => {
    const { opened, deps } = fakes({ '/w/kc': 'manufosela/karajan-code' });
    const rooms = await startRooms({ ...deps, targets: () => ['/w/kc'], env: { KJ_ROOM: 'off' } });
    expect(opened).toEqual([]);
    expect(rooms.byRepo.size).toBe(0);
  });
});
