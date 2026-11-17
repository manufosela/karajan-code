// KJC-BUG-0623 (asked by the maintainer on 2026-11-16): "the workshops vanish at once and there is an
// odd jump as they go and the rest move. It should be softer: it fades, leaving its gap; then each
// block slides gently into its place". How a workshop fades in or out, and slides. Pure: hall.js
// applies it.

/** How long a workshop takes to fade in or out, and to slide to its new place. */
export const FADE_MS = 700;
export const SLIDE_MS = 900;

/**
 * KJC-BUG-0633: where in the row (`order`) a workshop goes: a new lane last; one that comes back,
 * where it stood, after the lanes seen before it. `rank` (lane → when first seen) keeps that order.
 */
export function placeOf(order, rank, lane) {
  if (!rank.has(lane)) rank.set(lane, rank.size);
  const after = order.findIndex((other) => rank.get(other) > rank.get(lane));
  return after === -1 ? order.length : after;
}

const clamp = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => k * k * (3 - 2 * k);

/** How visible a workshop is at `now`: fading out once `leaving`, fading in since it was `born`. */
export function opacityAt({ leaving, born }, now) {
  if (leaving) return clamp(1 - (now - leaving.at) / FADE_MS);
  return clamp((now - born) / FADE_MS);
}

/** Where a workshop sliding by `move` ({ from, to, at }) stands at `now`; null with no move. */
export function slideAt(move, now) {
  if (!move) return null;
  const k = smooth(clamp((now - move.at) / SLIDE_MS));
  if (k >= 1) return { ...move.to };
  return { x: move.from.x + (move.to.x - move.from.x) * k, z: move.from.z + (move.to.z - move.from.z) * k };
}
