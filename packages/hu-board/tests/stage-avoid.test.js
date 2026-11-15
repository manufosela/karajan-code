// KJC-TSK-1634 (asked by the maintainer on 2026-11-15): "when they cross they go through each other
// like ghosts; they should step aside. Like in a game".
import { describe, expect, it } from 'vitest';

import { AVOID, avoidance } from '../public/stage/avoid.js';

const walking = (x, z, yaw = 0) => ({ x, z, yaw, walking: true });
const still = (x, z) => ({ x, z, yaw: 0, walking: false });
const gap = (a, b, offsets) => Math.hypot(a.x + offsets[0].dx - (b.x + offsets[1].dx), a.z + offsets[0].dz - (b.z + offsets[1].dz));

describe('avoidance', () => {
  it('robots apart keep to their way', () => {
    expect(avoidance([walking(0, 0), walking(3, 0)])).toEqual([{ dx: 0, dz: 0 }, { dx: 0, dz: 0 }]);
  });

  it('two walking robots too close step aside from each other, both, and end further apart', () => {
    const a = walking(0, 0);
    const b = walking(0.3, 0);
    const offsets = avoidance([a, b]);
    expect(offsets[0].dx).toBeLessThan(0);
    expect(offsets[1].dx).toBeGreaterThan(0);
    expect(gap(a, b, offsets)).toBeGreaterThan(0.3);
  });

  it('two meeting head on, at the very same spot, step aside sideways to their way, not along it', () => {
    const offsets = avoidance([walking(1, 1, 0), walking(1, 1, Math.PI)]);
    expect(Math.abs(offsets[0].dx)).toBeGreaterThan(0.1);
    expect(Math.abs(offsets[0].dz)).toBeLessThan(1e-9);
    expect(offsets[1].dx).toBeCloseTo(-offsets[0].dx);
  });

  it('one standing still stays put; the one walking goes round it', () => {
    const offsets = avoidance([still(0, 0), walking(0.2, 0)]);
    expect(offsets[0]).toEqual({ dx: 0, dz: 0 });
    expect(offsets[1].dx).toBeGreaterThan(0);
  });

  it('a crowd never throws one further than a robot\'s width', () => {
    const offsets = avoidance([walking(0, 0), walking(0.05, 0), walking(-0.05, 0), walking(0, 0.05), walking(0, -0.05)]);
    for (const { dx, dz } of offsets) expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(AVOID.radius + 1e-9);
  });
});
