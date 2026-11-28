// KJC-TSK-1832 (ADR "kj stage en una línea", decision 5, accepted 2026-11-27): "el muro tiene un solo
// dron, grande y bien definido, que lleva y recoge las tarjetas a la vista. Fuera los mensajeros."
// One drone docked over the task wall takes every card errand, one after another: it flies to where
// the card is, takes it, flies it to where it goes, leaves it and comes back, always in sight.
// Pure: wall-drone-mesh.js draws it.
import { WALL } from './layout.js';

export const WALL_DRONE_TRIP_MS = 9000;
/** Where it waits, over the wall, in sight. */
export const DOCK = { x: WALL.x, y: WALL.y + WALL.height + 1.2, z: WALL.z + 0.8 };

const CRUISE = 5;
/** Where the carried note hangs: its centre this far under the drone, and how tall it is. */
export const NOTE = { below: 1.1, height: 1 };
const LOW = NOTE.below + NOTE.height / 2 + 0.3; // keeps the note's bottom 0.3 m over the floor
const WALL_TAKE = WALL.y + WALL.height - 0.1; // the top of the cards, in sight above the lane rows

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

/** One drone, one errand at a time: each trip starts when it arrives or when the one before ends. */
export function droneTrips(trips) {
  let free = -Infinity;
  return trips.map((trip) => {
    const start = Math.max(trip.start ?? trip.at, free);
    free = start + WALL_DRONE_TRIP_MS;
    return { ...trip, start };
  });
}

const ease = (k) => k * k * (3 - 2 * k);
const high = (p) => ({ ...p, y: CRUISE });

/** The legs of an errand: where each ends, how long it takes, and whether the card is held after it. */
function legsOf(trip, xOf, zOf) {
  const lane = { x: xOf(trip.lane), y: LOW, z: zOf(trip.lane) };
  const wall = { x: WALL.x, y: WALL_TAKE, z: WALL.z + 0.6 };
  const [from, to] = trip.out ? [lane, wall] : [wall, lane];
  return [
    [high(from), 1500, false], [from, 700, false], [from, 450, true], [high(from), 700, true],
    [high(to), 2000, true], [to, 700, true], [to, 450, false], [high(to), 700, false], [DOCK, 1800, false],
  ];
}

/** Where the drone is at `now` and the card it holds (an id, or null); `scheduled` is droneTrips' answer. */
export function wallDroneAt(scheduled, now, xOf, zOf) {
  const trip = scheduled.find((t) => now >= t.start && now < t.start + WALL_DRONE_TRIP_MS);
  if (!trip) return { ...DOCK, carrying: null };
  let left = now - trip.start;
  let from = DOCK;
  let carrying = null;
  for (const [to, ms, holds] of legsOf(trip, xOf, zOf)) {
    if (left < ms) {
      const k = ease(left / ms);
      const at = (axis) => from[axis] + (to[axis] - from[axis]) * k;
      return { x: at('x'), y: at('y'), z: at('z'), carrying };
    }
    left -= ms;
    from = to;
    carrying = holds ? trip.id : null;
  }
  return { ...DOCK, carrying: null };
}
