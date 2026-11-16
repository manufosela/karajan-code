// KJC-TSK-1655 (the maintainer, 2026-11-16, with KJC-BUG-0623): "there is an odd jump as the
// workshops go and the rest move". When the hall grows or shrinks the camera glides to its framing.
import { describe, expect, it } from 'vitest';

import { GLIDE_MS, glideAt } from '../public/stage/camera-glide.js';

const glide = { from: { pos: { x: 0, y: 10, z: 10 }, target: { x: 0, y: 0, z: 0 } }, to: { pos: { x: 4, y: 20, z: 30 }, target: { x: 2, y: 0, z: 1 } }, at: 1000 };

describe('glideAt', () => {
  it('goes from the old framing to the new one over GLIDE_MS, slow at both ends', () => {
    expect(glideAt(glide, 1000)).toEqual(glide.from);
    const half = glideAt(glide, 1000 + GLIDE_MS / 2);
    expect(half.pos.y).toBeCloseTo(15);
    expect(half.target.x).toBeCloseTo(1);
    expect(glideAt(glide, 1000 + GLIDE_MS / 10).pos.z).toBeLessThan(12); // eases in
    expect(GLIDE_MS).toBeLessThanOrEqual(1000);
  });

  it('once there it is done: no glide left', () => {
    expect(glideAt(glide, 1000 + GLIDE_MS)).toBeNull();
    expect(glideAt(null, 0)).toBeNull();
  });
});
