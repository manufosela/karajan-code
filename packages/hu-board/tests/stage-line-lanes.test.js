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
  it('stands every workshop on the same row, one after another, a workshop and a gap apart', () => {
    for (const n of COUNTS) {
      const spots = Array.from({ length: n }, (_, i) => workshopAt(i, n));
      for (const s of spots) expect(s.z).toBe(WORKSHOP.z);
      for (const [a, b] of spots.slice(1).map((s, i) => [spots[i], s])) expect(b.x - a.x).toBeCloseTo(PITCH);
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
      expect(viewCentre(n)).toBeCloseTo((workshopAt(0, n).x + workshopAt(n - 1, n).x) / 2);
      const half = hallSpan(n).width / 2;
      expect(viewCentre(n) - half).toBeLessThanOrEqual(booth.from);
      expect(viewCentre(n) + half).toBeGreaterThanOrEqual(workshopAt(n - 1, n).x + WORKSHOP.width / 2);
      expect(lanes.from).toBeLessThan(viewCentre(n));
    }
  });

  it('adds no depth: there is only one row', () => {
    for (const n of COUNTS) expect(hallDepth(n)).toBe(0);
  });
});
