// KJC-TSK-1663 (asked by the maintainer on 2026-11-17): "a coffee cart robot could come and serve the
// waiting agents a cup; when they have to work again it comes back and takes it". Pure: coffee-floor.js
// draws it. A trip is { host, serve, at, spot }: serve true brings a cup, false takes it back.
// KJC-TSK-1813 (the maintainer, 2026-11-27): one cart on its rounds, only for a wait that lasts, and a
// host that works again leaves its cup on its desk, where the cart comes to take it.
import { DESK } from './desk-layout.js';
import { IDLE } from './idle-waits.js';
import { AISLE_DZ, WORKSHOP } from './layout.js';
import { BUD_MS, HOST_WALK_MS, TYPING_YAW, hostAt, spotOf, visitKey, workerAt } from './workers.js';

/** KJC-TSK-1813: how long a host waits before the cart comes, so no cup is brought for a moment. */
export const SERVE_AFTER_MS = 120_000;
/** Whether a host waiting so (`waiting`) holds its cup in its hand: it waits for someone, it does not rest. */
export const inHand = (waiting) => Boolean(waiting) && !IDLE.has(waiting);

/** How long the cart walks each way (as a host does), and how long it stays to hand over or take the cup. */
export const CART_WALK_MS = HOST_WALK_MS;
const HAND_MS = 2500;
/** When, into its trip, the cup changes hands; and how long a whole trip lasts, booth to booth. */
export const HAND_AT_MS = BUD_MS + CART_WALK_MS + HAND_MS / 2;
export const CART_TRIP_MS = 2 * BUD_MS + 2 * CART_WALK_MS + HAND_MS;
const lastOf = (trips, host) => trips.findLast((t) => t.host === host);

/**
 * KJC-TSK-1813: the hosts the stage draws at their desks at `now` ({ key, waiting, spot }), the only
 * ones the cart serves; not one still walking in, teleporting or gone. `place` is the floor's xOf, zOf and door.
 */
export function hostsAtDesks(workers, now, { xOf = () => 0, zOf = () => WORKSHOP.z, door } = {}) {
  return workers.filter((w) => w.role === 'host' && w.leftAt === undefined).flatMap((w) => {
    const pose = workerAt(w, now, xOf, zOf, door);
    if (!pose || pose.walking || pose.size < 1) return [];
    return [{ key: visitKey(w), waiting: w.waiting ?? null, spot: spotOf('host', xOf(w.lane), w.slot, zOf(w.lane)) }];
  });
}

/** KJC-TSK-1813: when each host that waits for someone began to (`prev` as it was), as { key: ms }. */
export function waitsSince(prev, hosts, now) {
  return Object.fromEntries(hosts.filter((h) => inHand(h.waiting)).map(({ key }) => [key, prev[key] ?? now]));
}

/** The trip the cart is called for: a cup left on a desk first, else the longest wait that has lasted. */
function nextCall(trips, hosts, now) {
  const held = (key) => lastOf(trips, key)?.serve === true;
  const left = hosts.find(({ key, waiting }) => !inHand(waiting) && held(key) && now >= lastOf(trips, key).at + HAND_AT_MS);
  if (left) return { host: left.key, serve: false, at: now, spot: left.spot };
  // KJC-TSK-1805, 1811: a resting or done host waits for nothing, so no cup.
  const due = hosts.filter(({ key, waiting, since }) => inHand(waiting) && !held(key) && now - since >= SERVE_AFTER_MS);
  const first = due.toSorted((a, b) => a.since - b.since)[0];
  return first ? { host: first.key, serve: true, at: now, spot: first.spot } : null;
}

/**
 * The cart's trips after the hosts at `now` ({ key, waiting, since, spot }). KJC-TSK-1813: there is
 * one cart, so while a trip is under way nobody else is called. Trips done long ago are forgotten,
 * but each host's last one stays, which says whether it has its cup.
 */
export function withCoffee(trips, hosts, now) {
  const busy = trips.some((t) => now < t.at + CART_TRIP_MS);
  const called = busy ? null : nextCall(trips, hosts, now);
  const present = new Set(hosts.map((h) => h.key));
  const kept = trips.filter((t) => now < t.at + CART_TRIP_MS || (present.has(t.host) && lastOf(trips, t.host) === t));
  if (!called && kept.length === trips.length) return trips;
  return called ? [...kept, called] : kept;
}

/** KJC-TSK-1813: where a host's cup stands on its desk (desk-layout.js): on its top, beside the laptop on the camera's side. */
export function deskCupSpot({ x, z }) {
  const side = DESK.width / 2 - 0.06;
  return {
    x: x + DESK.ahead * Math.sin(TYPING_YAW) - side * Math.cos(TYPING_YAW),
    y: DESK.laptop,
    z: z + DESK.ahead * Math.cos(TYPING_YAW) + side * Math.sin(TYPING_YAW),
  };
}

/** KJC-TSK-1813: the cups on the desks at `now`: of each host that has one and no longer waits for someone. */
export function cupOnDesk(trips, hosts, now) {
  return hosts.filter(({ key, waiting }) => !inHand(waiting) && hasCup(trips, key, now)).map(({ key, spot }) => ({ host: key, ...deskCupSpot(spot) }));
}

/** Whether `host` holds a cup at `now`: from the hand-over of the cup it was served to the cart taking it. */
export function hasCup(trips, host, now) {
  // KJC-TSK-1813: by its last trip, as the one that served it may be forgotten while the cart comes to take it.
  const own = trips.filter((t) => t.host === host);
  const last = own.at(-1);
  if (!last) return false;
  if (last.serve) return now >= last.at + HAND_AT_MS;
  const served = own.at(-2);
  return now < last.at + HAND_AT_MS && (!served || now >= served.at + HAND_AT_MS);
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
