// KJC-TSK-1831: where the camera stands to see the line from the front. Pure, no three import.
import { hallWidth } from './layout.js';

/** The lens and how high it looks from, in degrees above the floor. */
export const CAMERA = { fov: 36, elevation: 44 };

/** KJC-TSK-1847: how far the view tilts, in degrees above the floor, and per wheel px. */
export const TILT = { min: 12, max: 78, perPx: 0.05 };

/** KJC-TSK-1847: the elevation after a wheel step; up (negative delta) looks more from above. */
export const tiltBy = (elevation, delta) => Math.min(TILT.max, Math.max(TILT.min, elevation - delta * TILT.perPx));

/** KJC-TSK-1831: the width the camera fits: the lanes, at most 45 m; the warehouse never widens it. */
export const fitWidth = (n) => hallWidth(n);

/** The camera's offset from its target to fit `width` metres on a screen of `aspect`, from the front. */
export function framingOffset(width, aspect, elevation = CAMERA.elevation) {
  const halfView = Math.tan((CAMERA.fov / 2) * (Math.PI / 180)) * aspect;
  const distance = Math.max(22, ((width / 2 + 2) / halfView) * 1.1);
  const radians = elevation * (Math.PI / 180);
  return { x: 0, y: distance * Math.sin(radians), z: distance * Math.cos(radians) };
}
