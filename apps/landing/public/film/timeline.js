// The film's clock: when each beat happens and the easing every move uses.
// Everything on screen is a pure function of the film time, so the film can be
// skipped, replayed or frozen at any frame.

export const T = {
  rogueDrop: 6, rogueHops: 6.45, rogueHop: 0.45, refuse: 7.6, rogueGone: 8.25,
  honestDrop: 8.3, honestHops: 8.7, honestHop: 0.42,
  outro: 12.7, titles: 13.2, end: 14.7,
};

/** Where the seven tool crates stand on the staff, left to right. */
export const SLOTS = [-5, -3.5, -2, -0.5, 1, 2.5, 4];
export const VERDICT_X = 5.6;
export const SPAWN_X = -6.3;

// The reviewed diff hops from the spawn point over every crate onto the pedestal.
T.verdict = T.honestHops + (SLOTS.length + 1) * T.honestHop;

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** Progress of t through [a, b], clamped to 0..1. */
export const span = (t, a, b) => clamp01((t - a) / (b - a));
export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const easeOut = (x) => 1 - (1 - x) ** 4;
export const easeIn = (x) => x * x * x;
export const lerp = (a, b, x) => a + (b - a) * x;
/** A half-sine bump that starts at a and lasts len seconds. */
export const pulse = (t, a, len) => (t < a || t > a + len ? 0 : Math.sin((Math.PI * (t - a)) / len));
/** A short blink every few seconds; offset keeps the robots out of sync. */
export const blinkAt = (t, offset) => {
  const phase = (t + offset) % 4.3;
  return phase < 0.14 ? Math.sin((Math.PI * phase) / 0.14) : 0;
};

/**
 * Position along a chain of hops at time t, each hop a parabola of `dur` seconds.
 * The spin makes a full turn per hop, so a label always lands upright.
 */
export function hops(points, t0, dur, t, peak = 0.95) {
  const n = points.length - 1;
  const k = Math.min(Math.max((t - t0) / dur, 0), n);
  const i = Math.min(Math.floor(k), n - 1);
  const u = k - i;
  const [ax, ay] = points[i];
  const [bx, by] = points[i + 1];
  const y = lerp(ay, by, u) + (peak + Math.abs(by - ay) * 0.5) * 4 * u * (1 - u);
  const started = i > 0 || u > 0;
  const squash = k < n && started ? Math.max(0, 1 - u / 0.18) : 0;
  return { x: lerp(ax, bx, u), y, spin: -(Math.PI * 2) * (i + easeInOut(u)), squash, index: i, u, landed: k >= n };
}

/** How far the final frame has slid aside to make room for the hero copy (0..1). */
export const asideAt = (t) => easeInOut(span(t, T.outro, T.outro + 2));
