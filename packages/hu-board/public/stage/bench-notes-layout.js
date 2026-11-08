// KJC-TSK-1462 (ADR 0050, point 3): where each card in progress sits over its lane's
// bench while the work lasts. Pure: bench-notes.js puts the notes there.
import { WORKSHOP } from './layout.js';

export const NOTE_GAP = 0.9; // metres between two notes of one bench

/**
 * The spot of each card in progress over its bench, `{ id, x, z }`; one a robot is still
 * carrying (`carried` ids) is not there yet. `xOf(lane)` is the centre of a lane's workshop.
 */
export function benchSpots(cards, xOf, carried) {
  const byLane = Map.groupBy(cards.filter((c) => c.status === 'running' && !carried.has(c.id)), (c) => c.lane ?? 'main');
  return [...byLane].flatMap(([lane, here]) => here.map((c, i) => ({
    id: c.id,
    x: xOf(lane) + (i - (here.length - 1) / 2) * NOTE_GAP,
    z: WORKSHOP.z + 0.4,
  })));
}
