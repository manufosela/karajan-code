// KJC-TSK-1639 (asked by the maintainer on 2026-11-15): "a workshop stays on 'pipeline failed'…
// when it runs it looks like it goes on its own… can we show something?" → "a conveyor belt; if it
// fails it turns red". A lane's pipeline (HU-4029: its open pull request's CI) as a belt.
// KJC-TSK-1826: beside the desks, not behind them, ending at the right of the workshop where the
// work leaves toward the gates and the rest of the line. Pure: belt.js draws it.
import { WORKSHOP } from './layout.js';

/** The belt in the workshop's frame: left to right, on the right of the desks, at their depth. */
export const BELT = { from: 2.8, to: WORKSHOP.width / 2 - 0.2, z: 0.1, box: 0.18, boxes: 2 };
// KJC-BUG-0689: a box grows in and shrinks out within this distance of each end of the belt.
const FADE = 0.15;

/** KJC-BUG-0689: how big a box at x along the belt is drawn, 0 at either end and whole inside. */
export const boxScale = (x) => Math.min(1, Math.max(0, Math.min(x - BELT.from, BELT.to - x) / FADE));
/** How long a box takes from one end to the other while the pipeline runs. */
export const BELT_MS = 6000;

const TONES = new Set(['running', 'failed', 'passed']);

/** How the belt looks for `pipeline`: null without an open pull request; it moves only while running. */
export const beltLook = (pipeline) => (TONES.has(pipeline) ? { tone: pipeline, moving: pipeline === 'running' } : null);

/** Where the belt's boxes stand at `now` (ms), as x along it: riding, stopped, or one at the gates. */
export function boxesAt(pipeline, now) {
  const look = beltLook(pipeline);
  if (!look) return [];
  const span = BELT.to - BELT.from;
  if (look.tone === 'passed') return [BELT.to - 0.25];
  const phase = look.moving ? (now % BELT_MS) / BELT_MS : 0;
  return Array.from({ length: BELT.boxes }, (_, i) => BELT.from + ((i / BELT.boxes + phase) % 1) * span);
}
