// KJC-TSK-1547 (asked by the maintainer on 2026-11-11): the release, seen on the stage. A drone
// comes down to the "Ready to release" table, lifts its pile and flies away with it; once it is
// gone, kaWATCHan walks to the version counter, switches it to the new release and walks back.
// Pure: live.js poses the drone, the pile, the counter and kaWATCHan from these.
import { CREW, RELEASE_TABLE, VERSION_BOARD } from './layout.js';

export const DESCEND_MS = 2200;
export const PICK_MS = 900;
export const AWAY_MS = 2600;
export const WALK_MS = 1800;
const SWITCH_MS = 700; // kaWATCHan at the counter, switching it
const GONE_MS = DESCEND_MS + PICK_MS + AWAY_MS;
export const FLIGHT_END_MS = GONE_MS + 2 * WALK_MS + SWITCH_MS;

const SKY = { x: RELEASE_TABLE.x + 2, y: 9, z: RELEASE_TABLE.z - 3 };
const OVER = { x: RELEASE_TABLE.x, y: 1.5, z: RELEASE_TABLE.z };
const FAR = { x: RELEASE_TABLE.x + 10, y: 10, z: RELEASE_TABLE.z - 10 };
// kaWATCHan stands in front of the counter, a step short of its post.
const AT_COUNTER = { x: VERSION_BOARD.x - 0.6, z: VERSION_BOARD.z + 0.8 };

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * k, z: a.z + (b.z - a.z) * k });
const ease = (k) => k * k * (3 - 2 * k);

/** The release moment seen at `now`: from `before` to `after`, with the pile of cards it takes. */
export const releaseFlight = (before, after, cards, now) => ({ start: now, before, after, cards });

/** Where the drone is at `now` and whether it carries the pile; null before or after its flight. */
export function droneAt(flight, now) {
  const t = flight ? now - flight.start : -1;
  if (t < 0 || t >= GONE_MS) return null;
  if (t < DESCEND_MS) return { ...lerp(SKY, OVER, ease(t / DESCEND_MS)), carrying: false };
  if (t < DESCEND_MS + PICK_MS) return { ...OVER, carrying: t >= DESCEND_MS + PICK_MS / 2 };
  return { ...lerp(OVER, FAR, ease((t - DESCEND_MS - PICK_MS) / AWAY_MS)), carrying: true };
}

/** The cards on the table at `now`: the release's pile until the drone takes it, else `ready`. */
export function tableCards(flight, now, ready) {
  const t = flight ? now - flight.start : -1;
  return t >= 0 && t < DESCEND_MS + PICK_MS / 2 ? flight.cards : ready;
}

/** Where kaWATCHan is at `now`: at its place, walking to the counter, at it, or walking back. */
export function watcherAt(flight, now) {
  const home = { x: CREW.watch.x, z: CREW.watch.z };
  const t = flight ? now - flight.start - GONE_MS : -1;
  const facing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  if (t < 0 || t >= 2 * WALK_MS + SWITCH_MS) return { ...home, yaw: CREW.watch.yaw, walking: false };
  if (t < WALK_MS) return { ...lerp(home, AT_COUNTER, t / WALK_MS), yaw: facing(home, AT_COUNTER), walking: true };
  if (t < WALK_MS + SWITCH_MS) return { ...AT_COUNTER, yaw: facing(AT_COUNTER, VERSION_BOARD), walking: false };
  return { ...lerp(AT_COUNTER, home, (t - WALK_MS - SWITCH_MS) / WALK_MS), yaw: facing(AT_COUNTER, home), walking: true };
}

/** The release the counter says at `now`: the old one until kaWATCHan reaches it, else `release`. */
export function counterRelease(flight, now, release) {
  const t = flight ? now - flight.start : Infinity;
  return t >= 0 && t < GONE_MS + WALK_MS ? flight.before : release;
}
