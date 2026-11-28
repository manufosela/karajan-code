// KJC-TSK-1817 (ADR "kj stage en una línea", accepted 2026-11-27): the hall goes in one line, left to
// right, nothing behind anything: booth, Karajan's team, his pieces, the agents' desks, the task wall,
// the release table with its counter and kaWATCHan, the mailbox, the warehouse and its crane.
import { describe, expect, it } from 'vitest';

import { LINE, LINE_ORDER, lineCentre, lineGroups, lineWidth } from '../public/stage/line-layout.js';
import { STATIONS, WORKSHOP } from '../public/stage/layout.js';

const COUNTS = [1, 2, 4, 7, 12];

describe('the one-line hall', () => {
  it('keeps the order the maintainer gave', () => {
    expect(LINE_ORDER).toEqual(['booth', 'team', 'pieces', 'lanes', 'wall', 'release', 'mailbox', 'warehouse']);
    for (const n of COUNTS) expect(lineGroups(n).map((g) => g.id)).toEqual(LINE_ORDER);
  });

  // KJC-TSK-1842: two rows; stage-line-rows.test.js checks the back row's order.
  it('gives each group its own stretch, the warehouse last of all', () => {
    for (const n of COUNTS) {
      const groups = lineGroups(n);
      for (const g of groups) expect(g.to).toBeGreaterThan(g.from);
      for (const g of groups.slice(0, -1)) expect(groups.at(-1).from).toBeGreaterThanOrEqual(g.to); // no gaps
    }
  });

  it('never moves a lane: the lanes start at the same x whatever their number, a workshop apart', () => {
    const lanes = (n) => lineGroups(n).find((g) => g.id === 'lanes');
    for (const n of COUNTS) {
      expect(lanes(n).from).toBe(lanes(1).from);
      expect(lanes(n).to - lanes(n).from).toBeCloseTo(n * (WORKSHOP.width + WORKSHOP.gap));
    }
  });

  it('has room for every piece of Karajan, a post apart', () => {
    const pieces = lineGroups(1).find((g) => g.id === 'pieces');
    expect(pieces.to - pieces.from).toBeGreaterThan(STATIONS.length * 1);
  });

  it('measures the line and finds its middle, for the camera', () => {
    for (const n of COUNTS) {
      const groups = lineGroups(n);
      expect(lineWidth(n)).toBeCloseTo(groups.at(-1).to - groups[0].from);
      expect(lineCentre(n)).toBeCloseTo((groups.at(-1).to + groups[0].from) / 2);
      if (n > 1) expect(lineWidth(n)).toBeGreaterThanOrEqual(lineWidth(n - 1)); // KJC-TSK-1842: the back row may be the longer
    }
  });

  it('stands on one row, in front of the hall', () => {
    expect(Number.isFinite(LINE.z)).toBe(true);
    expect(LINE.aisleZ).toBeGreaterThan(LINE.z);
  });
});
