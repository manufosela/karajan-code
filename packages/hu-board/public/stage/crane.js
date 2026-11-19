// KJC-TSK-1705 (the maintainer, 2026-11-19): "pensar algo para que tenga sentido que se muevan... no
// quiero que aparezcan y desaparezcan bloques". A crane carries a workshop between its slab on the
// warehouse's shelves and its slot in the hall: up, across over everyone (growing or shrinking), down.
// Pure: hall.js moves the workshop and its hook with what this says.

/** How long it lifts, carries and lowers; the height it carries at; a workshop's size as a slab. */
export const CRANE = { liftMs: 500, carryMs: 1600, lowerMs: 500, top: 4.2, small: 0.27 };
export const CRANE_MS = CRANE.liftMs + CRANE.carryMs + CRANE.lowerMs;

const clamp = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;

/** Where the workshop of `trip` ({ from, to, at }, each { x, y, z, scale }) hangs at `now`; null once it is set down. */
export function craneAt({ from, to, at }, now) {
  const t = Math.max(0, now - at);
  if (t >= CRANE_MS) return null;
  if (t < CRANE.liftMs) return { ...from, y: lerp(from.y, CRANE.top, smooth(t / CRANE.liftMs)) };
  const k = smooth(clamp((t - CRANE.liftMs) / CRANE.carryMs));
  if (t < CRANE.liftMs + CRANE.carryMs) {
    return { x: lerp(from.x, to.x, k), y: CRANE.top, z: lerp(from.z, to.z, k), scale: lerp(from.scale, to.scale, k) };
  }
  return { ...to, y: lerp(CRANE.top, to.y, smooth((t - CRANE.liftMs - CRANE.carryMs) / CRANE.lowerMs)) };
}
