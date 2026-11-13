// KJC-TSK-1589 (asked by the maintainer on 2026-11-13): desks on four legs where the agents open
// their laptops, where the bench was. KJC-TSK-1591 (the maintainer, 2026-11-13): an agent types
// side on (TYPING_YAW), so each seat has a standing desk of its own, turned with its agent and
// under its laptop; no chair, which would stand where the next agent does. In the workshop's own
// frame, in metres. Pure: hall.js builds the meshes.
import { SCALE } from './layout.js';
import { SEATS, TYPING_YAW, spotOf } from './workers.js';

// The laptop opens 1.05 ahead of its robot and 0.72 up, at the robot's scale (laptop.js,
// agents-floor.js); the top stays just under its base. As wide as the laptop, a little deeper.
export const DESK = { width: 0.72, depth: 0.34, top: 0.04, leg: 0.04, ahead: 1.05 * SCALE.crew, laptop: 0.35 };

/** One desk per seat: its centre, its turn, its top and its legs, these in the desk's own frame. */
export function deskParts() {
  const height = DESK.laptop - 0.01;
  const inset = (span) => span / 2 - DESK.leg;
  const legs = [-1, 1].flatMap((sa) => [-1, 1].map((sc) => ({ along: sa * inset(DESK.depth), across: sc * inset(DESK.width) })));
  return SEATS.map((_, seat) => {
    const spot = spotOf('host', 0, seat, 0);
    return {
      x: spot.x + DESK.ahead * Math.sin(TYPING_YAW),
      z: spot.z + DESK.ahead * Math.cos(TYPING_YAW),
      yaw: TYPING_YAW,
      width: DESK.width,
      depth: DESK.depth,
      height,
      thick: DESK.top,
      legs: legs.map((leg) => ({ ...leg, height: height - DESK.top, size: DESK.leg })),
    };
  });
}
