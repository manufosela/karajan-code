// KJC-TSK-1837 (the maintainer, 2026-11-28: "demasiado scroll horizontal", option 1): a more compact
// line. This first part brings the groups, Karajan's pieces and his team closer; the workshops follow.
import { describe, expect, it } from 'vitest';

import { lineGroups, lineWidth } from '../public/stage/line-layout.js';
import { CONSOLE, CREW, PLINTH_WIDTH, POST, STAND, STATIONS, postX } from '../public/stage/layout.js';

const group = (id) => lineGroups(1).find((g) => g.id === id);

describe('a more compact line', () => {
  // KJC-TSK-1842 (the maintainer, 2026-11-28: "no quiero huecos"): none at all now.
  it('leaves no gap between one group and the next', () => {
    for (const n of [1, 5]) {
      // KJC-TSK-1842: in the back row, Karajan's side.
      const groups = lineGroups(n).filter((g) => !['lanes', 'warehouse'].includes(g.id));
      for (const [a, b] of groups.slice(1).map((g, i) => [groups[i], g])) expect(b.from - a.to).toBeCloseTo(0);
    }
  });

  // KJC-TSK-1842 (the maintainer, 2026-11-28: "no quiero huecos"): each stretch as wide as what it holds.
  it('gives the wall, the release table and the mailbox no more room than they take', () => {
    const width = (id) => group(id).to - group(id).from;
    expect(width('wall')).toBeLessThanOrEqual(3.6);
    expect(width('release')).toBeLessThanOrEqual(4.4);
    expect(width('mailbox')).toBeLessThanOrEqual(1.5);
  });

  it('stands the pieces 1.1 m apart, so their 1 m plinths do not touch', () => {
    expect(POST.spacing).toBeCloseTo(1.1);
    expect(POST.spacing).toBeGreaterThan(PLINTH_WIDTH);
    const xs = STATIONS.map(postX);
    for (const [a, b] of xs.slice(1).map((x, i) => [xs[i], x])) expect(b - a).toBeCloseTo(1.1);
    expect(group('pieces').to - group('pieces').from).toBeCloseTo(STATIONS.length * 1.1);
  });

  it('fits Karajan\'s team in 5 m, each a robot from the next', () => {
    const team = group('team');
    expect(team.to - team.from).toBeLessThanOrEqual(5);
    const xs = [CREW.rag.x, STAND.x, CREW.conductor.x, CONSOLE.x];
    for (const [a, b] of xs.slice(1).map((x, i) => [xs[i], x])) expect(b - a).toBeGreaterThanOrEqual(0.9);
    expect(xs[0]).toBeGreaterThanOrEqual(team.from + 0.5);
    expect(xs.at(-1)).toBeLessThanOrEqual(team.to - 0.3);
  });

  it('makes a one-lane line some 8 m shorter than the 53 m it was', () => {
    expect(lineWidth(1)).toBeLessThanOrEqual(45);
  });
});
