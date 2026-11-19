// KJC-TSK-1461 (ADR 0050, points 2 to 4): a card's errand between its lane's workshop
// and the board wall. A new card is carried to the wall and pinned; a card started is
// fetched from the wall to the workshop; a card done is carried back. Pure, as ragan.js:
// couriers.js moves the robots.
import { PASSAGE, WALL, WORKSHOP, boothAt } from './layout.js';
import { BUD_MS } from './workers.js';

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

/**
 * KJC-BUG-0618 (the maintainer, 2026-11-16): "it cannot appear and disappear out of nothing". From
 * the booth and back to it: it teleports in, walks to its first stop (the workshop to take the card
 * it pins, the wall to take the one it brings), to the second, where it leaves it, and back.
 */
export const COURIER_TRIP_MS = 2 * BUD_MS + 3 * COURIER_WALK_MS + 2 * PIN_MS;

/** Where a walk along `points` is at `k` (0..1, its legs equally long in time), and which way it faces. */
function along(points, k) {
  const legs = points.length - 1;
  const at = Math.min(legs - 1e-9, Math.max(0, k) * legs);
  const i = Math.floor(at);
  return { ...lerp(points[i], points[i + 1], at - i), yaw: facing(points[i], points[i + 1]) };
}

const teleporting = (at, size) => ({ x: at.x, z: at.z, yaw: 0, walking: false, holding: false, size: Math.max(0, Math.min(1, size)) });

/** Where the errand's robot is at `now`, whether it walks, holds the card, and how whole it is; null before or after. */
export function courierAt(trip, now, xOf, zOf = () => WORKSHOP.z, door = boothAt(1)) {
  const t = now - trip.at;
  if (t < 0 || t >= COURIER_TRIP_MS) return null;
  const bench = { x: xOf(trip.lane), z: zOf(trip.lane) - 0.5 };
  const wall = { x: WALL.x, z: WALL.z + 0.6 };
  const booth = { x: door.x, z: door.z };
  // Out of the booth in front of the crew's row first, as the hosts do (BOOTH.exitZ).
  const exit = { x: door.x, z: door.exitZ ?? door.z };
  const [first, second] = trip.out ? [bench, wall] : [wall, bench];
  // KJC-TSK-1703: every way to or from the wall goes through the passage in the row of pieces.
  const viaPassage = (leg) => leg.flatMap((stop, i) => {
    const next = leg[i + 1];
    return next && (stop === wall) !== (next === wall) ? [stop, PASSAGE.front] : [stop];
  });
  const legs = [[booth, exit, first], [first, second], [second, exit, booth]].map(viaPassage);
  const face = (stop) => (stop === wall ? Math.PI : 0);
  if (t < BUD_MS) return teleporting(booth, t / BUD_MS);
  let left = t - BUD_MS;
  for (const [i, leg] of legs.entries()) {
    if (left < COURIER_WALK_MS) return { ...along(leg, left / COURIER_WALK_MS), walking: true, holding: i === 1, size: 1 };
    left -= COURIER_WALK_MS;
    const stop = leg.at(-1);
    // At each stop it takes the card or leaves it: it holds it while it does.
    if (i < 2 && left < PIN_MS) return { ...stop, yaw: face(stop), walking: false, holding: true, size: 1 };
    if (i < 2) left -= PIN_MS;
  }
  return teleporting(booth, 1 - left / BUD_MS);
}
