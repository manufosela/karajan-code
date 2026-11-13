// KJC-TSK-1589 (asked by the maintainer on 2026-11-13): each workshop has a desk with legs and a
// chair at each seat, where the agents open their laptops, instead of the rectangular bench.
import { describe, expect, it } from 'vitest';

import { DESK, deskParts } from '../public/stage/desk-layout.js';
import { SEATS, spotOf } from '../public/stage/workers.js';

describe('deskParts', () => {
  const parts = deskParts();

  it('a top as wide as the bench was, at the same height, with a leg at each corner under it', () => {
    expect(parts.top).toMatchObject({ y: DESK.height - DESK.top / 2, width: DESK.width });
    expect(parts.legs).toHaveLength(4);
    for (const leg of parts.legs) {
      expect(Math.abs(leg.x)).toBeLessThan(DESK.width / 2);
      expect(Math.abs(leg.z - DESK.z)).toBeLessThan(DESK.depth / 2);
    }
  });

  it('one chair behind each seat of the bench, where the robot stands, never under the top', () => {
    expect(parts.chairs.map((c) => c.x)).toEqual(SEATS);
    const robot = spotOf('host', 0, 0, 0); // in the workshop's own frame, as the desk is drawn
    for (const chair of parts.chairs) expect(chair.z).toBeLessThan(robot.z);
    for (const chair of parts.chairs) expect(chair.z).toBeLessThan(DESK.z - DESK.depth / 2);
  });
});
