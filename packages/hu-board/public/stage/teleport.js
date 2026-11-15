// KJC-TSK-1633 (asked by the maintainer on 2026-11-15): "they don't fade, they get tiny; I want it to
// look like they teleport". How a robot looks while it forms or leaves (`size`, 0..1, the pose's):
// thin and stretched upwards inside a vertical beam of light, and its own shape once whole.
// Pure: agents-floor.js scales the robot and draws the beam.

const THIN = 0.05; // how thin the line of light it starts as is
const STRETCH = 0.8; // how much taller than the robot that line is

/** The scale across and up for `size`, and how bright the beam over it is (0: none). */
export function teleportLook(size) {
  if (typeof size !== 'number' || size >= 1) return { across: 1, up: 1, beam: 0 };
  const k = Math.max(0, size);
  // It widens fast at the end and shortens as it does, so the shape snaps into place.
  const across = THIN + (1 - THIN) * k * k;
  return { across, up: 1 + STRETCH * (1 - k), beam: 1 - k };
}
