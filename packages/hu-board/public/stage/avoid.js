// KJC-TSK-1634 (asked by the maintainer on 2026-11-15): "when they cross they go through each other
// like ghosts; they should step aside. Like in a game". Separation steering: each walking robot
// steps away from every robot closer than a robot's width; one standing still never moves.
// Pure: agents-floor.js draws each robot at its pose plus its offset.

/**
 * How close two robots may come, in metres (a robot's width at the crew's scale); and, KJC-BUG-0598,
 * how close two standing still may be before they too step apart (only when they overlap).
 */
// KJC-BUG-0626: and `sight`, how far ahead a walking robot starts stepping aside, before they touch.
export const AVOID = { radius: 0.8, overlap: 0.5, sight: 1.6 };

/** KJC-BUG-0598: a robot standing still steps apart, half the overlap, only from another still one on it. */
function stillOffset(self, i, poses) {
  let dx = 0;
  let dz = 0;
  poses.forEach((other, j) => {
    if (i === j || other.walking) return;
    const { ux, uz, d } = awayFrom(self, other);
    if (d >= AVOID.overlap) return;
    dx += ux * (AVOID.overlap - d) * 0.5;
    dz += uz * (AVOID.overlap - d) * 0.5;
  });
  return { dx, dz };
}

/** The way a robot steps from `other`: straight away, or to its own right when they share a spot. */
function awayFrom(self, other) {
  const dx = self.x - other.x;
  const dz = self.z - other.z;
  const d = Math.hypot(dx, dz);
  // At the very same spot each takes its own right, so two meeting head on go to opposite sides.
  return d > 1e-6 ? { ux: dx / d, uz: dz / d, d } : { ux: Math.cos(self.yaw), uz: -Math.sin(self.yaw), d };
}

/**
 * KJC-BUG-0626 (the maintainer, 2026-11-17): "they seem to crash, and each turns back". A walking
 * robot steps aside sideways, across its way, to the side the other is not on; head on, to its own
 * right, so two meeting pass each other as in a corridor, never pushed back along their way.
 */
function sideStep(self, other) {
  const { ux, uz, d } = awayFrom(self, other);
  const right = { x: Math.cos(self.yaw), z: -Math.sin(self.yaw) };
  const across = ux * right.x + uz * right.z;
  const side = Math.abs(across) < 0.2 ? 1 : Math.sign(across);
  return { ux: right.x * side, uz: right.z * side, d };
}

/** Each pose's offset `{ dx, dz }`: none apart or standing still; at most a robot's width. */
export function avoidance(poses) {
  return poses.map((self, i) => {
    if (!self.walking) return stillOffset(self, i, poses);
    let dx = 0;
    let dz = 0;
    poses.forEach((other, j) => {
      if (i === j) return;
      const { ux, uz, d } = sideStep(self, other);
      if (d >= AVOID.sight) return;
      // Two walking share the step; past one standing still, the walker takes all of it.
      const push = ((AVOID.sight - d) / AVOID.sight) * AVOID.radius * (other.walking ? 0.5 : 1);
      dx += ux * push;
      dz += uz * push;
    });
    const k = Math.min(1, AVOID.radius / (Math.hypot(dx, dz) || 1));
    return { dx: dx * k, dz: dz * k };
  });
}
