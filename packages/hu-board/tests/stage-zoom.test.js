// KJC-TSK-1433 (ADR 0048): zoom in and out with the wheel and with a pinch, within limits.
import { describe, expect, it } from 'vitest';

import { ZOOM, pinchZoom, wheelZoom } from '../public/stage/zoom.js';

describe('stage zoom', () => {
  it('the wheel down moves away and up comes closer, never past the limits', () => {
    expect(wheelZoom(1, 100)).toBeGreaterThan(1);
    expect(wheelZoom(1, -100)).toBeLessThan(1);
    expect(wheelZoom(1, 1e6)).toBe(ZOOM.max);
    expect(wheelZoom(1, -1e6)).toBe(ZOOM.min);
  });

  it('fingers apart come closer, together move away, and a lost gap changes nothing', () => {
    expect(pinchZoom(1, 100, 200)).toBe(0.5);
    expect(pinchZoom(0.5, 200, 100)).toBe(1);
    expect(pinchZoom(1, 0, 100)).toBe(1);
    expect(pinchZoom(1, 10, 1000)).toBe(ZOOM.min);
  });
});
