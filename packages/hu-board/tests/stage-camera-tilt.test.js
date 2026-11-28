// KJC-TSK-1847 (the maintainer, 2026-11-28: "no sé si la perspectiva se puede mover con combinación de
// tecla + ratón/rueda"): Shift and the wheel tilt the view; the wheel alone still zooms. With Shift,
// browsers often turn the wheel into a sideways scroll, so either delta tilts.
import { describe, expect, it } from 'vitest';

import { CAMERA, TILT, framingOffset, tiltBy } from '../public/stage/camera-fit.js';
import { wheelAction } from '../public/stage/zoom.js';

const degrees = ({ y, z }) => (Math.atan2(y, z) * 180) / Math.PI;

describe('tilting the view', () => {
  it('lets Shift and the wheel tilt, and leaves the wheel alone to zoom', () => {
    expect(wheelAction({ shiftKey: true, deltaY: 100, deltaX: 0 })).toEqual({ tilt: 100 });
    expect(wheelAction({ shiftKey: true, deltaY: 0, deltaX: -100 })).toEqual({ tilt: -100 });
    expect(wheelAction({ shiftKey: false, deltaY: 100, deltaX: 0 })).toEqual({ zoom: 100 });
  });

  // The map of every factory cannot tilt: there Shift and the wheel still zoom, as before.
  it('zooms with Shift and the wheel where the view cannot tilt', () => {
    expect(wheelAction({ shiftKey: true, deltaY: 100, deltaX: 0 }, false)).toEqual({ zoom: 100 });
    expect(wheelAction({ shiftKey: true, deltaY: 100, deltaX: 0 }, true)).toEqual({ tilt: 100 });
  });

  it('tilts towards overhead one way and towards level the other, within its limits', () => {
    expect(tiltBy(CAMERA.elevation, -100)).toBeGreaterThan(CAMERA.elevation);
    expect(tiltBy(CAMERA.elevation, 100)).toBeLessThan(CAMERA.elevation);
    expect(tiltBy(CAMERA.elevation, -1e6)).toBe(TILT.max);
    expect(tiltBy(CAMERA.elevation, 1e6)).toBe(TILT.min);
    expect(TILT.min).toBeGreaterThanOrEqual(10);
    expect(TILT.max).toBeLessThanOrEqual(80);
  });

  it('frames the view at the elevation it is given, as far away as before', () => {
    const at = framingOffset(30, 16 / 9, 60);
    expect(degrees(at)).toBeCloseTo(60);
    const usual = framingOffset(30, 16 / 9);
    expect(Math.hypot(at.y, at.z)).toBeCloseTo(Math.hypot(usual.y, usual.z));
    expect(degrees(usual)).toBeCloseTo(CAMERA.elevation);
  });
});
