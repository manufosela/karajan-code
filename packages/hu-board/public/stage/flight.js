// KJC-TSK-1455 (ADR 0049): the flight to a factory of the map. Pure: where the
// pointer touches the floor, which factory's floor that is, and where the camera
// is at each moment of the flight.
import { FLOOR_Z } from './map-layout.js';

export const FLIGHT_MS = 900;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/** Where the camera looks and how close, at `now` of a `{ from, to, start }` flight; null without one. */
export function flightAt(flight, now) {
  if (!flight) return null;
  const t = Math.min(1, Math.max(0, (now - flight.start) / FLIGHT_MS));
  if (t === 1) return { ...flight.to, done: true }; // lands exactly, no rounding left over
  const k = ease(t);
  const along = (key) => flight.from[key] + (flight.to[key] - flight.from[key]) * k;
  return { x: along('x'), z: along('z'), zoom: along('zoom'), done: false };
}

/** Where a ray from `origin` along `dir` meets the floor (y = 0), or null when it never does. */
export function groundAt(origin, dir) {
  if (dir.y >= 0) return null;
  const t = -origin.y / dir.y;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}

/** The index of the factory whose floor holds `point`, from the `{ x, z, width, depth }` of each lot, or -1. */
export function lotAt(point, lots) {
  if (!point) return -1;
  // KJC-TSK-1488: a factory of several rows of workshops has a deeper floor.
  return lots.findIndex(({ x, z, width, depth = FLOOR_Z.front - FLOOR_Z.back }) =>
    Math.abs(point.x - x) <= width / 2 && point.z >= z + FLOOR_Z.back && point.z <= z + FLOOR_Z.back + depth);
}
