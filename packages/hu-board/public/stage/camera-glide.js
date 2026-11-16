// KJC-TSK-1655 (asked by the maintainer on 2026-11-16, with KJC-BUG-0623): "there is an odd jump as
// the workshops go and the rest move". When the hall grows or shrinks the camera glides from its old
// framing to the new one instead of jumping. Pure: main.js moves the camera.

/** How long the camera takes to reach its new framing. */
export const GLIDE_MS = 900;

const smooth = (k) => k * k * (3 - 2 * k);
const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/** Where the camera is (`pos`) and looks (`target`) at `now` on its `glide`; null once there or with none. */
export function glideAt(glide, now) {
  if (!glide) return null;
  const t = (now - glide.at) / GLIDE_MS;
  if (t >= 1) return null;
  const k = smooth(Math.max(0, t));
  return { pos: mix(glide.from.pos, glide.to.pos, k), target: mix(glide.from.target, glide.to.target, k) };
}
