// KJC-TSK-1625 (asked by the maintainer on 2026-11-14): the things of the hall say what they are
// under the pointer: the "Ready to release" table, the stack of finished workshops and the task
// wall. Each is a box in the factory's frame; the box under the pointer on screen is the one.
// Pure: workshop-pointer.js projects the boxes and shows the tooltip.
import { columnOf } from './cards.js';
import { RELEASE_TABLE, WALL } from './layout.js';
import { readyToRelease } from './release.js';
import { STACK, stackSpot } from './finished-stack.js';

const box = (id, [x0, y0, z0], [x1, y1, z1]) => ({ id, min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
const half = STACK.size / 2;

/** The boxes of the things, the stack first while it has `stacked` blocks (it stands before the table). */
export function thingBoxes(stacked) {
  const t = RELEASE_TABLE;
  const things = [
    box('release', [t.x - 1, 0, t.z - 0.8], [t.x + 1, 1.4, t.z + 0.8]),
    box('wall', [WALL.x - WALL.width / 2, WALL.y, WALL.z - 0.1], [WALL.x + WALL.width / 2, WALL.y + WALL.height, WALL.z + 0.1]),
  ];
  if (!stacked) return things;
  const first = stackSpot(0);
  const last = stackSpot(stacked - 1);
  const top = stackSpot(Math.min(stacked, STACK.high) - 1);
  return [box('stack', [first.x - half, 0, first.z - half], [last.x + half, top.y + half, first.z + half]), ...things];
}

/** The rectangle on screen that holds the projected `points` ({ left, top } in css px). */
export function rectOf(points) {
  const lefts = points.map((p) => p.left);
  const tops = points.map((p) => p.top);
  return { left: Math.min(...lefts), right: Math.max(...lefts), top: Math.min(...tops), bottom: Math.max(...tops) };
}

/** The first thing whose rectangle holds `pointer`; null when none. */
export const thingAt = (pointer, rects) => rects.find(({ rect }) => pointer.left >= rect.left && pointer.left <= rect.right
  && pointer.top >= rect.top && pointer.top <= rect.bottom)?.id ?? null;

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What a thing says: its name, what it holds now and how it goes. */
export function thingTip(id, { cards, release, stacked }) {
  if (id === 'release') {
    const ready = readyToRelease(cards, release);
    const ids = ready.length ? `: ${ready.map((c) => c.id).join(', ')}` : '';
    return ['Ready to release', `${plural(ready.length, 'card')} done since ${release?.tag ?? 'the start (no release yet)'}${ids}`,
      'The drone takes them when the next release is published.'];
  }
  if (id === 'stack') {
    return ['Finished workshops', `${plural(stacked.length, 'lane')} merged or done, waiting for the release: ${stacked.map((b) => b.label).join(', ')}`,
      'One box per lane; the table holds the cards. The release takes both.'];
  }
  const count = (column) => cards.filter((c) => columnOf(c.status) === column).length;
  return ['Task wall', `${count('todo')} to do · ${count('doing')} in progress · ${count('done')} done`];
}
