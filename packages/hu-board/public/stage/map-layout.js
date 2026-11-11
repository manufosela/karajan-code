// KJC-TSK-1452 (ADR 0049): where each factory stands on the map, in metres, the
// busiest factory (first in the list) at the back left. KJC-TSK-1467: each lot is
// only as wide as its own hall, and the lots are packed in rows with a narrow gap;
// one lot as wide as the widest hall left the small factories in a sea of floor.
import { hallDepth, hallWidth } from './layout.js';

/** The hall from behind its door to past its nameplates, along z (layout.js). */
export const FLOOR_Z = { back: -9.5, front: 6 };
export const GAP = 1.5;
// KJC-TSK-1482: the name stands at the back of each floor; seen at three quarters it
// rose over the factory behind, so rows keep more room between them than neighbours.
export const ROW_GAP = 7;
const DEPTH = FLOOR_Z.front - FLOOR_Z.back;
const WIDER = 1.5; // rows a little wider than a square, as the screen is

/** Splits the widths into rows of about `target` metres, in order. */
function rowsOf(widths, target) {
  const rows = [];
  for (const [i, width] of widths.entries()) {
    const row = rows.at(-1);
    if (row && row.width + GAP + width <= target) {
      row.items.push(i);
      row.width += GAP + width;
    } else rows.push({ items: [i], width });
  }
  return rows;
}

/**
 * Each factory's lot from the lane count of each: `lots[i]` is the origin of its
 * hall, the width of its floor (1 m wider each side than the hall) and its depth,
 * from behind the door to past its front row of workshops (KJC-TSK-1488); `width`
 * and `depth` are the bounds of the whole map, centred on 0.
 */
export function packLots(laneCounts) {
  return pack(laneCounts);
}

/**
 * KJC-BUG-0555: the map packed again for the lane counts `now`, or null while they are the
 * ones it was packed for (`before`): a factory that grows lanes gets a lot of its new size.
 */
export function repacked(before, now) {
  const same = now.length === before.length && now.every((n, i) => n === before[i]);
  return same ? null : pack(now);
}

function pack(laneCounts) {
  const widths = laneCounts.map((n) => hallWidth(n) + 2);
  const depths = laneCounts.map((n) => DEPTH + hallDepth(n));
  const area = widths.reduce((sum, w, i) => sum + (w + GAP) * (depths[i] + ROW_GAP), 0);
  const rows = rowsOf(widths, Math.max(...widths, Math.sqrt(area * WIDER)));
  // Each row of the map is as deep as its deepest floor; the floors line up at the back.
  const rowDepths = rows.map((row) => Math.max(...row.items.map((i) => depths[i])));
  const width = Math.max(...rows.map((row) => row.width));
  const depth = rowDepths.reduce((sum, d) => sum + d, 0) + (rows.length - 1) * ROW_GAP;
  const lots = [];
  let back = -depth / 2;
  for (const [r, row] of rows.entries()) {
    let left = -row.width / 2;
    for (const i of row.items) {
      lots[i] = { x: left + widths[i] / 2, z: back - FLOOR_Z.back, width: widths[i], depth: depths[i] };
      left += widths[i] + GAP;
    }
    back += rowDepths[r] + ROW_GAP;
  }
  return { lots, width, depth };
}
