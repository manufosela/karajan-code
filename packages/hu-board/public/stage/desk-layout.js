// KJC-TSK-1589 (asked by the maintainer on 2026-11-13): a workshop's desk, where its agents open
// their laptops: a top on four legs where the bench was, and a chair behind each seat of the
// bench (workers.js), where the robot stands. In the workshop's own frame, in metres. Pure:
// hall.js builds the meshes.
import { WORKSHOP } from './layout.js';
import { SEATS } from './workers.js';

// Low enough that the badge on a working robot's chest shows over it (KJC-TSK-1435).
export const DESK = { width: WORKSHOP.width * 0.8, depth: 0.6, height: 0.35, top: 0.05, z: 0.4, leg: 0.05 };
const CHAIR = { z: -0.9, seat: 0.2, size: 0.32, back: 0.3 };

/** Where each part of the desk stands: its top, its legs and the chairs. */
export function deskParts() {
  const inset = (span) => span / 2 - DESK.leg;
  const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * inset(DESK.width), z: DESK.z + sz * inset(DESK.depth) })));
  return {
    top: { y: DESK.height - DESK.top / 2, z: DESK.z, width: DESK.width, depth: DESK.depth, thick: DESK.top },
    legs: legs.map((leg) => ({ ...leg, height: DESK.height - DESK.top, size: DESK.leg })),
    chairs: SEATS.map((x) => ({ x, z: CHAIR.z, seat: CHAIR.seat, size: CHAIR.size, back: CHAIR.back })),
  };
}
