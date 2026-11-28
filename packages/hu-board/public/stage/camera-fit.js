// KJC-TSK-1831: where the camera stands to see the line from the front. Pure, no three import.
import { hallWidth } from './layout.js';

/** The lens and how high it looks from, in degrees above the floor. */
export const CAMERA = { fov: 36, elevation: 20 };

/** KJC-TSK-1831: the width the camera fits: the lanes, at most 45 m; the warehouse never widens it. */
export const fitWidth = (n) => hallWidth(n);

/** The camera's offset from its target to fit `width` metres on a screen of `aspect`, from the front. */
export function framingOffset(width, aspect) {
  const halfView = Math.tan((CAMERA.fov / 2) * (Math.PI / 180)) * aspect;
  const distance = Math.max(22, ((width / 2 + 2) / halfView) * 1.1);
  const elevation = CAMERA.elevation * (Math.PI / 180);
  return { x: 0, y: distance * Math.sin(elevation), z: distance * Math.cos(elevation) };
}
