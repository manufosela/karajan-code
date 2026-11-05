// KJC-TSK-1430 (decided by the maintainer on 2026-11-05): each agent kj launches
// is a robot of its own. It walks in from the back door when its work starts,
// works behind its station (the coder at TDD, the reviewer and Solomon at AI
// review) and walks out when it ends. Pure: the scene reads the poses.
import { STATION_X, STATIONS } from './layout.js';

export const WALK_MS = 2500;
export const DOOR = { x: -12, z: -4.5 };
const BEHIND_Z = -2.4;
const ROLE_STATION = { coder: 'tdd', reviewer: 'review', solomon: 'review' };
// Solomon stands beside the reviewer it arbitrates, not on top of it.
const ROLE_SHIFT = { solomon: 0.9 };
// Each agent wears its own colour; one kj does not know yet wears a neutral grey.
const ACCENTS = { claude: 0xd97757, codex: 0x9aa4ff, agy: 0x7ee0b5 };
export const accentOf = (agent) => ACCENTS[agent] ?? 0xc0c8d0;
/** The key of one robot's whole visit, from walking in to walking out. */
export const visitKey = (w) => `${w.agent}:${w.role}:${w.since}`;

/** Where an agent in `role` works. */
export function spotOf(role) {
  const x = STATION_X[STATIONS.indexOf(ROLE_STATION[role] ?? 'review')];
  return { x: x + (ROLE_SHIFT[role] ?? 0), z: BEHIND_Z };
}

/** The worker of this agent and role that has not left yet (a leftAt of 0 is a real departure). */
const inside = (w, ev) => w.agent === ev.agent && w.role === ev.role && w.leftAt === undefined;

/** The workers after an agent-activity event at `now` (ms); other events change nothing. */
export function withActivity(workers, event, now) {
  if (event?.type !== 'agent-activity') return workers;
  if (event.phase === 'start') {
    return workers.some((w) => inside(w, event)) ? workers : [...workers, { agent: event.agent, role: event.role, since: now }];
  }
  return workers.map((w) => (inside(w, event) ? { ...w, leftAt: now } : w));
}

/** The agents already at work when the stage opens, standing at their spot. */
export const workersFrom = (working, now) => working.map(({ agent, role }) => ({ agent, role, since: now - WALK_MS }));

const lerp = (from, to, k) => ({ x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k });
const facing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

/** Where a worker is at `now` and whether it walks, or null once it has left. */
export function workerAt(worker, now) {
  const spot = spotOf(worker.role);
  if (worker.leftAt !== undefined && now >= worker.leftAt) {
    const k = (now - worker.leftAt) / WALK_MS;
    return k >= 1 ? null : { ...lerp(spot, DOOR, k), yaw: facing(spot, DOOR), walking: true };
  }
  const k = Math.min(1, Math.max(0, (now - worker.since) / WALK_MS));
  return k < 1 ? { ...lerp(DOOR, spot, k), yaw: facing(DOOR, spot), walking: true } : { ...spot, yaw: 0, walking: false };
}
