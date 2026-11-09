// KJC-TSK-1461 (ADR 0050, points 2 to 4): a card's errand between its lane's workshop
// and the board wall. A new card is carried to the wall and pinned; a card started is
// fetched from the wall to the workshop; a card done is carried back. Pure, as ragan.js:
// couriers.js moves the robots.
import { WALL, WORKSHOP } from './layout.js';

export const COURIER_WALK_MS = 2400;
export const PIN_MS = 900;

/**
 * KJC-TSK-1493: the two lines of a card's note, its prefix small and its number big,
 * so a long id (OXP-TSK-0123) is read whole instead of cut at the edge.
 */
export function noteLines(id) {
  const cut = id.lastIndexOf('-');
  return cut < 0 ? ['', id] : [id.slice(0, cut), id.slice(cut + 1)];
}

/** The errand a `card` event sets going at `now`, or null when none does. */
export function tripFor(event, now) {
  if (event?.type !== 'card' || event.queued) return null;
  const toWall = event.action === 'add' || event.status === 'done';
  const fetch = event.action === 'move' && event.status === 'running';
  if (!toWall && !fetch) return null;
  return { id: event.id, lane: event.lane ?? 'main', at: now, out: toWall, back: fetch };
}

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
const facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);

/** Where the errand's robot is at `now`, whether it walks and holds the card; null before or after. */
export function courierAt(trip, now, xOf, zOf = () => WORKSHOP.z) {
  const t = now - trip.at;
  if (t < 0 || t >= 2 * COURIER_WALK_MS + PIN_MS) return null;
  const bench = { x: xOf(trip.lane), z: zOf(trip.lane) - 0.5 };
  const wall = { x: WALL.x, z: WALL.z + 0.6 };
  if (t < COURIER_WALK_MS) return { ...lerp(bench, wall, t / COURIER_WALK_MS), yaw: facing(bench, wall), walking: true, holding: trip.out };
  // At the wall it pins the card it brought or takes the one it came for: it holds it while it does.
  if (t < COURIER_WALK_MS + PIN_MS) return { ...wall, yaw: Math.PI, walking: false, holding: true };
  const k = (t - COURIER_WALK_MS - PIN_MS) / COURIER_WALK_MS;
  return { ...lerp(wall, bench, k), yaw: facing(wall, bench), walking: true, holding: trip.back };
}
