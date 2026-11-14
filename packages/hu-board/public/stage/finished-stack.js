// KJC-TSK-1623 (decided by the maintainer on 2026-11-14, «Pila hasta publicar»): a finished lane
// leaves the row of workshops; while it waits for a release it is a block stacked by the "Ready to
// release" table, and the release takes it. Pure: stack-mesh.js draws the blocks, live.js folds.
import { atHome } from './cards.js';
import { RELEASE_TABLE } from './layout.js';
import { plateName } from './lane-status.js';

/** The blocks: their side, how many stand one on another, and the gap between columns. */
export const STACK = { size: 0.5, high: 4, gap: 0.12 };

/** The lanes that leave the row of workshops: the finished ones, never main. */
export const finishedLanes = (statuses) => [...statuses]
  .filter(([lane, status]) => lane !== 'main' && status.state === 'finished')
  .map(([lane]) => lane);

const labelOf = (lane) => /^HU-\d+/.exec(lane)?.[0] ?? plateName(lane).slice(0, 10);

/**
 * The blocks of the stack: the finished `lanes` whose last card was done after `release` (all of
 * them without one; a lane without a done card, its time unknown, too), the oldest at the bottom.
 */
export function stackOf(lanes, cards, release) {
  const done = atHome(cards, lanes).filter((card) => card.status === 'done');
  const since = release ? Date.parse(release.at) : -Infinity;
  return lanes
    .map((lane) => {
      const times = done.filter((card) => card.lane === lane).map((card) => card.at).toSorted();
      return { lane, label: labelOf(lane), at: times.at(-1) ?? null };
    })
    .filter((block) => block.at === null || Date.parse(block.at) > since)
    .toSorted((a, b) => (a.at === null) - (b.at === null) || Date.parse(a.at) - Date.parse(b.at));
}

/**
 * Where block `i` stands: right of the release table and in front of the version counter behind
 * it, in columns of STACK.high blocks.
 */
export function stackSpot(i) {
  const column = Math.floor(i / STACK.high);
  return {
    x: RELEASE_TABLE.x + 1.2 + column * (STACK.size + STACK.gap),
    y: STACK.size / 2 + (i % STACK.high) * STACK.size,
    z: RELEASE_TABLE.z + 0.9,
  };
}
