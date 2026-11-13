/**
 * KJC-TSK-1573 (ADR 0056): at start the board enters the room of each repository it shows, once per
 * repository, keeps its presence there and knows who else is live. KJ_ROOM=off keeps it out.
 */
import { sweepTargets } from '../lane-sweeper.js';
import { keepPresence } from './presence.js';
import { createRtdb } from './rtdb.js';
import { openSession } from './session.js';
import { runTeam } from './team.js';

/** A folder whose entry failed for a passing reason is tried again this often (KJC-TSK-1579). */
const RETRY_MS = 5 * 60 * 1000;

// KJC-TSK-1597: the GitHub login this board entered its rooms with (one token, one login).
let own = null;
/** The own GitHub login, or null while the board is in no room. */
export const ownLogin = () => own;

/**
 * @returns {Promise<{byRepo: Map<string, {session: object, rtdb: object, peers: string[], dirs: string[]}>, leave: () => Promise<void>}>}
 */
export async function startRooms({ targets = sweepTargets, open = openSession, rtdbOf = createRtdb, presence = keepPresence, team = runTeam, env = process.env, retryMs = RETRY_MS, log = console } = {}) {
  const byRepo = new Map();
  const leaves = [];
  let stopped = false;
  let timer = null;
  own = null;
  // Under the test runner a board never enters a real room unless a test asks for one.
  if (env.KJ_ROOM === 'off' || (env.VITEST && env.KJ_ROOM !== 'on')) return { byRepo, leave: async () => {} };
  /** KJC-TSK-1577: once every folder of a repository is known, its room runs its mesh. */
  const run = (room) => {
    room.team = team(room);
    const leavePresence = presence(room.session, room.rtdb, (peers) => {
      room.peers = peers;
      room.team.setPeers(peers);
      log.log(`[room] ${room.session.repo}: ${peers.length ? peers.join(', ') : 'nobody else'} here`);
    });
    leaves.push(async () => room.team.stop(), leavePresence);
  };
  /** Enters the rooms of `dirs`; returns the folders that failed for a passing reason. */
  const enter = async (dirs) => {
    const failed = [];
    const fresh = new Map();
    for (const dir of dirs) {
      const session = await open(dir).catch((err) => { log.warn(`[room] ${dir}: ${err.message}`); failed.push(dir); return null; });
      if (!session || byRepo.has(session.repo)) continue;
      own ??= session.login;
      const known = fresh.get(session.repo);
      if (known) known.dirs.push(dir);
      else fresh.set(session.repo, { session, rtdb: rtdbOf(session), peers: [], dirs: [dir] });
    }
    if (!stopped) for (const [repo, room] of fresh) { byRepo.set(repo, room); run(room); }
    return failed;
  };
  const again = async (dirs) => {
    const failed = await enter(dirs);
    if (failed.length && retryMs && !stopped) {
      timer = setTimeout(() => again(failed), retryMs);
      timer.unref?.();
    }
  };
  await again(targets());
  return { byRepo, leave: async () => { stopped = true; clearTimeout(timer); await Promise.all(leaves.map((leave) => leave())); } };
}
