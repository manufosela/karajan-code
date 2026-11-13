// KJC-TSK-1600 (decided by the maintainer on 2026-11-13): the labels over the robots covered the
// workshops' names and the robots themselves. By default only a host carries a short label, its
// owner; the robot pointed at (the mouse over it, or a tap) shows its full label; and of two labels
// that would overlap on screen the more important stays. Pure: agents-floor.js places them.
import { hostLabel, ownerOf } from './host-look.js';
import { labelOf } from './workers.js';

/** How far from a robot, in css px, the pointer still points at it. */
export const REACH_PX = 40;
// A label's box as stage.html draws it (12px text, its padding), centred over its point.
const CHAR_PX = 7;
const PAD_PX = 18;
const HEIGHT_PX = 20;

/** What a robot's label says: a host its owner, the one pointed at everything, anyone else nothing. */
export function tagText(worker, { own, pointed = false }) {
  if (worker.role !== 'host') return pointed ? labelOf(worker) : null;
  const base = pointed ? hostLabel(worker, own) : ownerOf(worker, own) ?? worker.agent;
  // KJC-TSK-1607: a waiting host says what it waits for.
  return worker.waiting ? `${base} · ${WAITS[worker.waiting] ?? WAITS.process}` : base;
}

const WAITS = { person: 'waits for you', process: 'waits for a process' };

/** The key of the robot nearest the pointer on screen within `reach`; null when none or no pointer. */
export function pickNear(pointer, robots, reach = REACH_PX) {
  if (!pointer) return null;
  let best = null;
  let bestDistance = reach;
  for (const robot of robots) {
    const distance = Math.hypot(robot.left - pointer.left, robot.top - pointer.top);
    if (distance < bestDistance) { best = robot.key; bestDistance = distance; }
  }
  return best;
}

const boxOf = ({ left, top, text }) => {
  const half = (text.length * CHAR_PX + PAD_PX) / 2;
  return { x0: left - half, x1: left + half, y0: top - HEIGHT_PX, y1: top };
};
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The labels that stay, in their order: of two that overlap, the one of higher `rank`. */
export function declutter(tags) {
  const kept = [];
  for (const tag of tags.toSorted((a, b) => b.rank - a.rank)) {
    const box = boxOf(tag);
    if (!kept.some((other) => overlap(box, other.box))) kept.push({ tag, box });
  }
  const stays = new Set(kept.map(({ tag }) => tag));
  return tags.filter((tag) => stays.has(tag));
}
