// KJC-TSK-1633 (asked by the maintainer on 2026-11-15): "they don't fade, they get tiny; I want it to
// look like they teleport".
import { describe, expect, it } from 'vitest';

import { teleportLook } from '../public/stage/teleport.js';

describe('teleportLook', () => {
  it('a whole robot: its own shape, no beam', () => {
    expect(teleportLook(1)).toEqual({ across: 1, up: 1, beam: 0 });
  });

  it('forming, it is a thin line of light stretched upwards, never tiny', () => {
    const start = teleportLook(0);
    expect(start.across).toBeLessThan(0.1);
    expect(start.up).toBeGreaterThan(1.5);
    expect(start.beam).toBe(1);
    const half = teleportLook(0.5);
    expect(half.across).toBeGreaterThan(start.across);
    expect(half.up).toBeLessThan(start.up);
    expect(half.up).toBeGreaterThan(1);
    expect(half.beam).toBeGreaterThan(0);
    expect(half.beam).toBeLessThan(1);
  });

  it('nothing to draw for a size it does not know', () => {
    expect(teleportLook(undefined)).toEqual({ across: 1, up: 1, beam: 0 });
  });
});
