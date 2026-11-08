// KJC-TSK-1433 (ADR 0048): zoom in and out with the wheel and with a pinch, within limits.
import { describe, expect, it } from 'vitest';

import { ZOOM, panTarget, pinchZoom, wheelZoom } from '../public/stage/zoom.js';

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

  // KJC-TSK-1454 (ADR 0049): the map goes from every factory down to one workshop.
  it('takes the limits of the view that asks, the map going much closer than one factory', () => {
    const deep = { min: 0.04, max: 1.3 };
    expect(wheelZoom(1, -1e6, deep)).toBe(0.04);
    expect(pinchZoom(1, 10, 1000, deep)).toBe(0.04);
    expect(wheelZoom(1, 1e6, deep)).toBe(1.3);
  });
});

describe('stage pan', () => {
  const bounds = { width: 100, depth: 40 };

  it('drags the map with the pointer: right and down move the view left and back', () => {
    expect(panTarget({ x: 0, z: 0 }, 10, 20, 0.5, bounds)).toEqual({ x: -5, z: -10 });
  });

  it('never looks at a point off the map, so an edge factory can still be centred', () => {
    expect(panTarget({ x: 0, z: 0 }, -1e6, -1e6, 1, bounds)).toEqual({ x: 50, z: 20 });
    expect(panTarget({ x: 0, z: 0 }, 1e6, 1e6, 1, bounds)).toEqual({ x: -50, z: -20 });
  });
});
