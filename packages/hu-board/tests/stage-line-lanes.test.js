// KJC-TSK-1828 (ADR "kj stage en una línea", accepted 2026-11-27): the lanes' workshops go in one
// row, left to right in their stretch of the line: no row of workshops behind another. KJC-TSK-1702
// (the maintainer, 2026-11-19, "no quiero baile de bloques de trabajo") still holds: a slot keeps its
// place whatever the number of workshops.
import { describe, expect, it } from 'vitest';

import { lineGroups } from '../public/stage/line-layout.js';
import { WORKSHOP, hallDepth, hallSpan, viewCentre, workshopAt } from '../public/stage/layout.js';

const PITCH = WORKSHOP.width + WORKSHOP.gap;
const COUNTS = [1, 2, 4, 7, 12];

describe('the workshops in one row', () => {
  // KJC-TSK-1842 (the maintainer, 2026-11-28): two wide at most; stage-line-rows.test.js has the rows.
  it('stands the first two workshops on the first row, a workshop and a gap apart', () => {
    for (const n of COUNTS.filter((c) => c >= 2)) {
      const [a, b] = [workshopAt(0, n), workshopAt(1, n)];
      expect(a.z).toBe(WORKSHOP.z);
      expect(b.z).toBe(WORKSHOP.z);
      expect(b.x - a.x).toBeCloseTo(PITCH);
    }
  });

  it('fills the lanes\' stretch of the line from its left end', () => {
    for (const n of COUNTS) {
      const lanes = lineGroups(n).find((g) => g.id === 'lanes');
      expect(workshopAt(0, n).x - WORKSHOP.width / 2).toBeCloseTo(lanes.from + WORKSHOP.gap / 2);
      expect(workshopAt(n - 1, n).x + WORKSHOP.width / 2).toBeLessThanOrEqual(lanes.to);
    }
  });

  it('never moves a slot when workshops come or go', () => {
    for (let i = 0; i < 7; i++) for (const n of [8, 12]) expect(workshopAt(i, n)).toEqual(workshopAt(i, 7));
  });

  // The camera looked at x 0, which is now the task wall: it looks at the lanes, and the drag, measured
  // from there, reaches both ends of the line (the booth on the left, the last workshop on the right).
  it('looks at the middle of the lanes and lets the drag reach both ends of the line from there', () => {
    for (const n of COUNTS) {
      const lanes = lineGroups(n).find((g) => g.id === 'lanes');
      const booth = lineGroups(n).find((g) => g.id === 'booth');
      // KJC-TSK-1842: stage-line-rows.test.js says where it looks now, both rows in view.
      const half = hallSpan(n).width / 2;
      expect(viewCentre(n) - half).toBeLessThanOrEqual(booth.from);
      expect(viewCentre(n) + half).toBeGreaterThanOrEqual(workshopAt(n - 1, n).x + WORKSHOP.width / 2);
      expect(lanes.from).toBeLessThan(viewCentre(n));
    }
  });

  it('adds depth only past two workshops', () => {
    for (const n of [1, 2]) expect(hallDepth(n)).toBe(0);
    for (const n of [4, 7, 12]) expect(hallDepth(n)).toBeGreaterThan(0);
  });
});
