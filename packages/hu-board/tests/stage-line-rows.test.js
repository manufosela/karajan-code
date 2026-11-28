// KJC-TSK-1842 (the maintainer, 2026-11-28, with a sketch; ADR "kj stage en una línea", decision 4
// revised): two rows seen from the front. Behind, starting over the first workshop, Karajan's side with
// no gaps: booth, team, pieces, task wall, release table and mailbox. In front, the workshops, two
// wide at most, growing towards the camera row by row ("no quiero huecos... 2 de ancho máximo").
// Right of both, the warehouse and its crane.
import { describe, expect, it } from 'vitest';

import { lineGroups, lineWidth } from '../public/stage/line-layout.js';
import { WORKSHOP, hallDepth, viewCentre, workshopAt } from '../public/stage/layout.js';
import { fitWidth } from '../public/stage/camera-fit.js';

const BACK = ['booth', 'team', 'pieces', 'wall', 'release', 'mailbox'];
const COUNTS = [1, 2, 5, 9];
const groupOf = (n, id) => lineGroups(n).find((g) => g.id === id);
const backWidth = (n) => groupOf(n, 'mailbox').to - groupOf(n, 'booth').from;

describe('two rows seen from the front', () => {
  it('starts Karajan\'s row over the first workshop, at the lanes\' left edge', () => {
    for (const n of COUNTS) expect(groupOf(n, 'booth').from).toBeCloseTo(groupOf(n, 'lanes').from);
  });

  it('lays Karajan\'s row left to right in its order, with no gaps', () => {
    for (const n of COUNTS) {
      const back = BACK.map((id) => groupOf(n, id));
      for (const g of back) expect(g.to).toBeGreaterThan(g.from);
      for (const [a, b] of back.slice(1).map((g, i) => [back[i], g])) expect(b.from - a.to).toBeCloseTo(0);
    }
  });

  it('keeps Karajan\'s row where it is whatever the number of lanes', () => {
    for (const id of BACK) for (const n of COUNTS) expect(groupOf(n, id).from).toBeCloseTo(groupOf(1, id).from);
  });

  it('stands the workshops two wide at most, each new row in front of the last', () => {
    for (const n of COUNTS) {
      const shops = Array.from({ length: n }, (_, i) => workshopAt(i, n));
      expect(new Set(shops.map((s) => s.x.toFixed(3))).size).toBe(Math.min(n, 2));
      expect(shops[0].x - WORKSHOP.width / 2).toBeGreaterThanOrEqual(groupOf(n, 'lanes').from);
      for (let i = 2; i < n; i++) {
        expect(shops[i].x).toBeCloseTo(shops[i - 2].x);
        expect(shops[i].z - shops[i - 2].z).toBeGreaterThan(WORKSHOP.depth + 1);
      }
      expect(hallDepth(n)).toBeCloseTo(shops.at(-1).z - shops[0].z);
    }
  });

  it('is as wide with twelve lanes as with two: no more horizontal scroll', () => {
    for (let n = 2; n <= 12; n++) expect(lineWidth(n)).toBeCloseTo(lineWidth(2));
  });

  it('puts the warehouse right of both rows', () => {
    for (const n of COUNTS) {
      const end = Math.max(groupOf(n, 'lanes').to, groupOf(n, 'mailbox').to);
      expect(groupOf(n, 'warehouse').from).toBeGreaterThanOrEqual(end);
    }
  });

  it('looks at the middle of both rows and fits all of Karajan\'s row, the warehouse left for the drag', () => {
    for (const n of COUNTS) {
      const lanes = groupOf(n, 'lanes');
      expect(viewCentre(n)).toBeCloseTo((lanes.from + Math.max(lanes.to, groupOf(n, 'mailbox').to)) / 2);
      expect(fitWidth(n)).toBeGreaterThanOrEqual(backWidth(n));
      expect(fitWidth(n)).toBeLessThanOrEqual(45);
    }
  });
});
