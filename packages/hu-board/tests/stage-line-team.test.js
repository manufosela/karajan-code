// KJC-TSK-1827 (ADR "kj stage en una línea", accepted 2026-11-27): the booth, Karajan's team and all
// his pieces stand on the line, left to right in that order, left of the lanes, on one row: nothing
// behind anything. The lanes keep their place: the line is anchored at the left edge of the hall's
// first column of workshops, and grows leftwards from there.
import { describe, expect, it } from 'vitest';

import { LINE, lineGroups } from '../public/stage/line-layout.js';
import { BOOTH, CONSOLE, CREW, POST, SENTINEL_POST, STAND, STATIONS, WORKSHOP, postX, workshopX } from '../public/stage/layout.js';

const groups = lineGroups(4);
const group = (id) => groups.find((g) => g.id === id);
const inside = (x, id) => {
  const g = group(id);
  expect(x).toBeGreaterThanOrEqual(g.from);
  expect(x).toBeLessThanOrEqual(g.to);
};

describe('the left of the line', () => {
  it('starts the lanes at the left edge of the hall\'s first column, where the workshops already are', () => {
    expect(group('lanes').from).toBeCloseTo(workshopX(0, 4) - (WORKSHOP.width + WORKSHOP.gap) / 2);
  });

  it('puts the booth first, in its stretch, on the line', () => {
    inside(BOOTH.x, 'booth');
    expect(BOOTH.z).toBe(LINE.z);
  });

  it('puts kaRAGan, atril, Karajan and his console in the team\'s stretch, in that order, on the line', () => {
    const xs = [CREW.rag.x, STAND.x, CREW.conductor.x, CONSOLE.x];
    for (const x of xs) inside(x, 'team');
    for (const [a, b] of xs.slice(1).map((x, i) => [xs[i], x])) expect(b).toBeGreaterThan(a);
    for (const z of [CREW.rag.z, STAND.z, CREW.conductor.z]) expect(z).toBe(LINE.z);
    expect(Math.abs(CONSOLE.z - LINE.z)).toBeLessThan(0.8);
  });

  it('puts every piece, the Sentinel too, in the pieces\' stretch, in the film\'s order, a post apart, on the line', () => {
    const xs = STATIONS.map(postX);
    for (const x of xs) inside(x, 'pieces');
    for (const [a, b] of xs.slice(1).map((x, i) => [xs[i], x])) expect(b - a).toBeGreaterThan(1);
    expect(POST.z).toBe(LINE.z);
    expect(SENTINEL_POST.x).toBe(postX('sentinel'));
    expect(SENTINEL_POST.z).toBe(LINE.z);
  });

  it('leaves nothing of Karajan\'s side in front of or behind the lanes', () => {
    const lanesFrom = group('lanes').from;
    for (const x of [BOOTH.x, CREW.rag.x, STAND.x, CREW.conductor.x, CONSOLE.x, ...STATIONS.map(postX)]) expect(x).toBeLessThan(lanesFrom);
  });
});
