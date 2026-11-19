// KJC-BUG-0623 (asked by the maintainer on 2026-11-16): "the workshops vanish at once and there is an
// odd jump as they go and the rest move. It should be softer: it fades, leaving its gap; then each
// block slides gently into its place". How a workshop fades in or out, and slides. Pure: hall.js
// applies it.

/** How long a workshop takes to fade in or out, and to slide to its new place. */
export const FADE_MS = 700;
export const SLIDE_MS = 900;

/**
 * KJC-TSK-1702 (the maintainer, 2026-11-19): "no quiero baile de bloques de trabajo". The hall is a
 * row of slots (`slots`, a lane or null): a lane takes its old slot when free (`last`, lane → slot;
 * KJC-BUG-0633, back where it stood), else the first gap, else the end. Nobody else moves.
 */
export function takeSlot(slots, last, lane) {
  if (slots.includes(lane)) return slots;
  const old = last.get(lane);
  const gap = old !== undefined && old < slots.length && slots[old] === null ? old : slots.indexOf(null);
  const at = gap === -1 ? slots.length : gap;
  const next = at === slots.length ? [...slots, lane] : slots.with(at, lane);
  last.set(lane, at);
  return next;
}

/** A lane leaves its slot: a gap for the next one, and the gaps at the end close. */
export function leaveSlot(slots, last, lane) {
  const at = slots.indexOf(lane);
  if (at === -1) return slots;
  last.set(lane, at);
  const next = slots.with(at, null);
  while (next.length && next.at(-1) === null) next.pop();
  return next;
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
