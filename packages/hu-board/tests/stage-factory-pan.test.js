// KJC-TSK-1592 (the maintainer, 2026-11-13): since Factories opens one factory alone (KJC-TSK-1590)
// it only zoomed on its middle; dragging walks over it, as over the map, within its hall.
import { describe, expect, it } from 'vitest';

import { BOOTH, DOOR, WORKSHOP, hallSpan, hallWidth, workshopAt } from '../public/stage/layout.js';
import { panTarget } from '../public/stage/zoom.js';

describe('hallSpan', () => {
  it('as wide as the hall, and deep from the door to the front of its last row of workshops', () => {
    for (const n of [1, 4, 9]) {
      const span = hallSpan(n);
      // The camera fits hallWidth; the drag reaches the booth, at the left end of the line.
      expect(span.width).toBeGreaterThanOrEqual(hallWidth(n));
      expect(span.width).toBeGreaterThanOrEqual(2 * Math.abs(BOOTH.x));
      const front = workshopAt(n - 1, n).z + WORKSHOP.depth / 2;
      expect(span.depth).toBeGreaterThanOrEqual(front - DOOR.z);
    }
  });

  it('a factory of more lanes reaches further along its one row, and no deeper', () => {
    expect(hallSpan(9).width).toBeGreaterThan(hallSpan(4).width);
    expect(hallSpan(9).depth).toBe(hallSpan(4).depth);
  });

  it('a long drag stops at the edge of the hall: the point looked at never leaves it', () => {
    const span = hallSpan(4);
    const far = panTarget({ x: 0, z: 0 }, -1e5, -1e5, 0.05, span);
    expect(far).toEqual({ x: span.width / 2, z: span.depth / 2 });
  });
});
