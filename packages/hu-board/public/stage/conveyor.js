// KJC-TSK-1639 (asked by the maintainer on 2026-11-15): "a workshop stays on 'pipeline failed'…
// when it runs it looks like it goes on its own… can we show something?" → "a conveyor belt; if it
// fails it turns red". A lane's pipeline (HU-4029: its open pull request's CI) as a belt at the back
// of its workshop, ending at its git gates, where the work leaves for the base branch. Pure:
// belt.js draws it.
import { WORKSHOP } from './layout.js';

/** The belt in the workshop's frame: from its left end to the gates (hall.js), behind the pad. */
export const BELT = { from: -WORKSHOP.width / 2 + 0.3, to: WORKSHOP.width / 2 - 0.9, z: -(WORKSHOP.depth / 2 + 0.3), boxes: 4 };
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
