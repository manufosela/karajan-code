// KJC-TSK-1452 (ADR 0049): where each factory stands on the map, in metres. The
// lots fill a near-square grid, centred, the busiest factory (first in the list) at
// the back left. KJC-TSK-1454: a lot is as big as the widest hall, plus an aisle.
import { hallWidth } from './layout.js';

/** The hall from behind its door to past its nameplates, along z (layout.js). */
export const FLOOR_Z = { back: -9.5, front: 6 };
export const AISLE = 4;

/** The lot every factory gets, from the lane count of each; the floor is 1 m wider each side than the hall. */
export function lotSize(laneCounts) {
  return { width: Math.max(...laneCounts.map(hallWidth)) + 2 + AISLE, depth: FLOOR_Z.front - FLOOR_Z.back + AISLE };
}

export const LOT = lotSize([1]);

const grid = (n) => {
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
};

/** The centre of factory `i`'s lot of `n`. */
export function lotOrigin(i, n, lot = LOT) {
  const { cols, rows } = grid(n);
  const along = (k, count, size) => (k - (count - 1) / 2) * size;
  return { x: along(i % cols, cols, lot.width), z: along(Math.floor(i / cols), rows, lot.depth) };
}

/** How wide and deep the map of `n` factories is, so the camera can fit it. */
export function mapSize(n, lot = LOT) {
  const { cols, rows } = grid(n);
  return { width: cols * lot.width, depth: rows * lot.depth };
}
