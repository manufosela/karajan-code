// KJC-TSK-1452 (ADR 0049): where each factory stands on the map, in metres, the
// busiest factory (first in the list) at the back left. KJC-TSK-1467: each lot is
// only as wide as its own hall, and the lots are packed in rows with a narrow gap;
// one lot as wide as the widest hall left the small factories in a sea of floor.
import { hallWidth } from './layout.js';

/** The hall from behind its door to past its nameplates, along z (layout.js). */
export const FLOOR_Z = { back: -9.5, front: 6 };
export const GAP = 1.5;
const DEPTH = FLOOR_Z.front - FLOOR_Z.back;
const MID = (FLOOR_Z.back + FLOOR_Z.front) / 2;
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
 * hall and the width of its floor (1 m wider each side than the hall); `width` and
 * `depth` are the bounds of the whole map, centred on 0.
 */
export function packLots(laneCounts) {
  const widths = laneCounts.map((n) => hallWidth(n) + 2);
  const area = widths.reduce((sum, w) => sum + (w + GAP) * (DEPTH + GAP), 0);
  const rows = rowsOf(widths, Math.max(...widths, Math.sqrt(area * WIDER)));
  const width = Math.max(...rows.map((row) => row.width));
  const depth = rows.length * DEPTH + (rows.length - 1) * GAP;
  const lots = [];
  for (const [r, row] of rows.entries()) {
    const z = -depth / 2 + DEPTH / 2 + r * (DEPTH + GAP) - MID;
    let left = -row.width / 2;
    for (const i of row.items) {
      lots[i] = { x: left + widths[i] / 2, z, width: widths[i] };
      left += widths[i] + GAP;
    }
  }
  return { lots, width, depth };
}
