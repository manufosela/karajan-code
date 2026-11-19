// KJC-TSK-1701 (the maintainer, 2026-11-19): "TDD, ledger, steward... should be drones: fly, stand over
// the agent, let a rope down with a camera, pick it up and go back to the base". The piece stays on its
// post, its drone docked on it; a visit (piece-visit.js) sends the drone up, over the hall, to hover
// over the piece's spot of the workshop, its camera down on the rope and up again, and back. Pure.
import { PIECE_WALK_MS, VISIT_SPOTS } from './piece-visit.js';

/** Heights: docked on its piece, hovering over the workshop, cruising over everyone between. */
export const DOCK_Y = 1.95;
export const HOVER_Y = 2.4;
export const CRUISE_Y = 3.4;
/** How far down the camera goes on its rope, and how long it takes each way. */
export const CABLE_MAX = 1.1;
const CABLE_MS = 450;

const clamp = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => k * k * (3 - 2 * k);
const docked = (home) => ({ x: home.x, y: DOCK_Y, z: home.z, cable: 0, flying: false });

/** From `a` to `b` at `k`: along a smooth line, rising to the cruise height on the way. */
function flight(a, b, k) {
  const s = smooth(clamp(k));
  const level = a.y + (b.y - a.y) * s;
  return { x: a.x + (b.x - a.x) * s, y: level + (CRUISE_Y - Math.max(a.y, b.y)) * Math.sin(Math.PI * s), z: a.z + (b.z - a.z) * s, cable: 0, flying: true };
}

/** Where the drone of a piece is at `now`: docked on `home` unless out on `visit`; `xOf`/`zOf` give a lane's workshop. */
export function pieceDroneAt(visit, now, home, xOf, zOf) {
  const t = visit ? now - visit.at : -1;
  if (t < 0 || now >= visit.until + PIECE_WALK_MS) return docked(home);
  const { dx, dz } = VISIT_SPOTS[visit.piece];
  const over = { x: xOf(visit.lane) + dx, y: HOVER_Y, z: zOf(visit.lane) + dz };
  // Called away on its way, it turns from where it is (piece-visit.js keeps the old visit in `from`).
  const start = visit.from ? pieceDroneAt(visit.from, visit.at, home, xOf, zOf) : docked(home);
  if (t < PIECE_WALK_MS) return flight(start, over, t / PIECE_WALK_MS);
  if (now < visit.until) {
    const down = Math.min(clamp((t - PIECE_WALK_MS) / CABLE_MS), clamp((visit.until - now) / CABLE_MS));
    return { ...over, cable: down * CABLE_MAX, flying: true };
  }
  return flight(over, docked(home), (now - visit.until) / PIECE_WALK_MS);
}
