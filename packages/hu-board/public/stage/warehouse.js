// KJC-TSK-1704 (the maintainer, 2026-11-19): "los bloques de trabajo, donde hay agentes, deban estar
// donde están y el resto en otro lado aparte... pero no quiero baile de bloques de trabajo". A workshop
// with nobody in it for a while goes to the warehouse beside the hall; one with an agent, or its
// pipeline running, comes back. Main, the factory's own line, never leaves. Pure: live.js applies it.

import { WORKSHOP } from './layout.js';

/** Shelves `high` levels tall at a fixed `x` right of the hall's four columns; a slab per stored workshop. */
// KJC-BUG-0644 (the maintainer, 2026-11-19): "muy alejado... más cerca del centro y más arriba": right
// against the columns, taller, and growing to the back of the hall instead of towards the camera.
export const RACK = { x: 15.9, high: 6, step: 0.62, bay: 1.15, w: 1.8, h: 0.32, d: 0.9 };

/** Where the slab of slot `i` of the warehouse stands: bottom shelf first, then the next bay back. */
export function rackSpot(i) {
  return { x: RACK.x, y: RACK.h / 2 + 0.25 + (i % RACK.high) * RACK.step, z: WORKSHOP.z - Math.floor(i / RACK.high) * RACK.bay };
}

/** How many bays deep the warehouse is with `n` slabs, for the camera; 0 when empty. */
export const rackBays = (n) => Math.ceil(n / RACK.high);

/** How long a lane stays idle before it is stored: a pause between turns stores nothing. */
export const STORE_AFTER_MS = 15 * 60_000;

/**
 * The lanes stored at `now` out of `lanes`, given the `busy` ones. `since` (lane → first seen idle) is
 * null while the stage opens, which stores every idle lane at once. Returns the set and the new `since`.
 */
export function storedNow(lanes, busy, stored, since, now) {
  const idle = lanes.filter((lane) => lane !== 'main' && !busy.has(lane));
  const next = new Map(idle.map((lane) => [lane, since ? (since.get(lane) ?? now) : -Infinity]));
  const store = new Set(idle.filter((lane) => stored.has(lane) || now - next.get(lane) >= STORE_AFTER_MS));
  return { store, since: next };
}
