// KJC-TSK-1663 (asked by the maintainer on 2026-11-17): "a coffee cart robot could come and serve the
// waiting agents a cup; when they have to work again it comes back and takes it". Pure: coffee-floor.js
// draws it. A trip is { host, serve, at, spot }: serve true brings a cup, false takes it back.
import { AISLE_DZ, WORKSHOP } from './layout.js';
import { BUD_MS, HOST_WALK_MS, hostAt } from './workers.js';

/** How long the cart walks each way (as a host does), and how long it stays to hand over or take the cup. */
export const CART_WALK_MS = HOST_WALK_MS;
const HAND_MS = 2500;
/** When, into its trip, the cup changes hands; and how long a whole trip lasts, booth to booth. */
export const HAND_AT_MS = BUD_MS + CART_WALK_MS + HAND_MS / 2;
export const CART_TRIP_MS = 2 * BUD_MS + 2 * CART_WALK_MS + HAND_MS;
const lastOf = (trips, host) => trips.findLast((t) => t.host === host);

/**
 * The cart's trips after the hosts at `now` ({ key, waiting, spot }): one serves a host that waits
 * with no cup coming, one takes the cup of a host that works again. Trips done long ago are forgotten,
 * but each host's last one stays, which says whether it holds its cup.
 */
export function withCoffee(trips, hosts, now) {
  const called = hosts.flatMap(({ key, waiting, spot }) => {
    const last = lastOf(trips, key);
    if (waiting && !last?.serve) return [{ host: key, serve: true, at: now, spot }];
    if (!waiting && last?.serve && now >= last.at + HAND_AT_MS) return [{ host: key, serve: false, at: now, spot }];
    return [];
  });
  const present = new Set(hosts.map((h) => h.key));
  const kept = trips.filter((t) => now < t.at + CART_TRIP_MS || (present.has(t.host) && lastOf(trips, t.host) === t));
  if (!called.length && kept.length === trips.length) return trips;
  return [...kept, ...called];
}

/** Whether `host` holds a cup at `now`: from the hand-over of the cup it was served to the cart taking it. */
export function hasCup(trips, host, now) {
  const handed = trips.filter((t) => t.host === host && now >= t.at + HAND_AT_MS);
  return Boolean(handed.at(-1)?.serve);
}

/**
 * Where the cart is at `now` on `trip`, whether it walks, carries a cup and how whole it is; null
 * outside it. It comes and goes by the booth as a host does (workers.js hostAt): out in front of the
 * crew's row, left of every workshop, along the host's aisle to stand side on in front of it and to its left, its cart before the host.
 */
export function cartAt(trip, now, door) {
  const t = now - trip.at;
  if (t < 0 || t >= CART_TRIP_MS) return null;
  const { x, z } = trip.spot;
  const beside = { x: x - 0.7, z: z + WORKSHOP.depth / 2 - 0.2 };
  const edgeX = door.edgeX ?? door.x;
  const exitZ = door.exitZ ?? door.z;
  const way = [{ x: door.x, z: door.z }, { x: door.x, z: exitZ }, { x: edgeX, z: exitZ }, { x: edgeX, z: z + AISLE_DZ }, { x, z: z + AISLE_DZ }, beside];
  const pose = hostAt({ since: trip.at, leftAt: trip.at + HAND_AT_MS + HAND_MS / 2 }, now, beside, way);
  // It carries the cup it serves until it hands it over, and the one it takes after it does.
  return { ...pose, yaw: pose.walking || pose.size < 1 ? pose.yaw : Math.PI / 2, cup: trip.serve ? t < HAND_AT_MS : t >= HAND_AT_MS };
}
