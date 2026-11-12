/**
 * KJC-TSK-1573 (ADR 0056): at start the board enters the room of each repository it shows, once per
 * repository, keeps its presence there and knows who else is live. KJ_ROOM=off keeps it out.
 */
import { sweepTargets } from '../lane-sweeper.js';
import { keepPresence } from './presence.js';
import { createRtdb } from './rtdb.js';
import { openSession } from './session.js';
import { runTeam } from './team.js';

/**
 * @returns {Promise<{byRepo: Map<string, {session: object, rtdb: object, peers: string[], dirs: string[]}>, leave: () => Promise<void>}>}
 */
export async function startRooms({ targets = sweepTargets, open = openSession, rtdbOf = createRtdb, presence = keepPresence, team = runTeam, env = process.env, log = console } = {}) {
  const byRepo = new Map();
  const leaves = [];
  // Under the test runner a board never enters a real room unless a test asks for one.
  if (env.KJ_ROOM === 'off' || (env.VITEST && env.KJ_ROOM !== 'on')) return { byRepo, leave: async () => {} };
  for (const dir of targets()) {
    const session = await open(dir).catch((err) => { log.warn(`[room] ${dir}: ${err.message}`); return null; });
    if (!session) continue;
    const known = byRepo.get(session.repo);
    if (known) known.dirs.push(dir);
    else byRepo.set(session.repo, { session, rtdb: rtdbOf(session), peers: [], dirs: [dir] });
  }
  // KJC-TSK-1577: once every folder of a repository is known, its room runs its mesh.
  for (const room of byRepo.values()) {
    room.team = team(room);
    const leavePresence = presence(room.session, room.rtdb, (peers) => {
      room.peers = peers;
      room.team.setPeers(peers);
      log.log(`[room] ${room.session.repo}: ${peers.length ? peers.join(', ') : 'nobody else'} here`);
    });
    leaves.push(async () => room.team.stop(), leavePresence);
  }
  return { byRepo, leave: async () => { await Promise.all(leaves.map((leave) => leave())); } };
}
