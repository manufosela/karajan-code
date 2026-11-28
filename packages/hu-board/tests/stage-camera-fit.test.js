// KJC-TSK-1831 (ADR "kj stage en una línea", accepted 2026-11-27; the maintainer, 2026-11-28, option 1:
// fit at most about 45 m centred on the lanes, drag for the rest). The camera stands in front of the
// line, and the warehouse never pulls it back: with stored workshops it fitted the line from x 0 to
// the rack twice over, and the whole hall shrank (the maintainer, 2026-11-28: "cada vez peor").
import { describe, expect, it } from 'vitest';

import { CAMERA, fitWidth, framingOffset } from '../public/stage/camera-fit.js';

const ASPECTS = [16 / 9, 4 / 3, 1];

describe('the camera in front of the line', () => {
  it('fits at most 45 m, whatever the number of lanes', () => {
    for (let n = 1; n <= 12; n++) {
      expect(fitWidth(n)).toBeLessThanOrEqual(45);
      expect(fitWidth(n)).toBeGreaterThan(20);
    }
  });

  // KJC-TSK-1842 (the maintainer, 2026-11-28: "he perdido perspectiva"): from above again, as before,
  // so the rows of workshops growing towards the camera are seen one under the other.
  it('stands in front of the line, looking down at it as before, about 45 degrees', () => {
    for (const aspect of ASPECTS) {
      const { x, y, z } = framingOffset(fitWidth(4), aspect);
      expect(x).toBe(0);
      expect(z).toBeGreaterThan(0);
      expect(y / z).toBeGreaterThanOrEqual(Math.tan((40 * Math.PI) / 180));
      expect(y / z).toBeLessThanOrEqual(Math.tan((50 * Math.PI) / 180));
    }
  });

  it('is far enough that the width it fits is all on screen', () => {
    for (const aspect of ASPECTS) {
      for (const n of [1, 4, 9]) {
        const width = fitWidth(n);
        const { y, z } = framingOffset(width, aspect);
        const distance = Math.hypot(y, z);
        const halfSeen = distance * Math.tan((CAMERA.fov / 2) * (Math.PI / 180)) * aspect;
        expect(halfSeen).toBeGreaterThanOrEqual(width / 2);
      }
    }
  });

  it('never goes further back for a wider window than the 45 m need', () => {
    const far = framingOffset(45, 1);
    expect(Math.hypot(far.y, far.z)).toBeLessThan(90);
  });
});
