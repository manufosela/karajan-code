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

  // KJC-BUG-0626 (the maintainer, 2026-11-17): "when one going out and one coming back cross they do
  // not dodge: they seem to crash, and each turns back". The step aside was straight away from the
  // other, which head on is back along the way.
  it('two walking head on step aside sideways, each to its own right, never back along their way', () => {
    const east = { x: 0, z: 0, yaw: Math.PI / 2, walking: true }; // walks towards +x
    const west = { x: 1, z: 0, yaw: -Math.PI / 2, walking: true }; // walks towards -x
    const [a, b] = avoidance([east, west]);
    expect(Math.abs(a.dx)).toBeLessThan(1e-9);
    expect(Math.abs(b.dx)).toBeLessThan(1e-9);
    expect(Math.sign(a.dz)).toBe(-Math.sign(b.dz));
    expect(Math.abs(a.dz)).toBeGreaterThan(0.1);
  });

  it('they start stepping aside before they touch, from further than a robot\'s width', () => {
    const east = { x: 0, z: 0, yaw: Math.PI / 2, walking: true };
    const west = { x: AVOID.sight - 0.1, z: 0, yaw: -Math.PI / 2, walking: true };
    expect(AVOID.sight).toBeGreaterThan(AVOID.radius);
    expect(Math.abs(avoidance([east, west])[0].dz)).toBeGreaterThan(0);
  });

  // KJC-TSK-1660 (the maintainer, 2026-11-17): "that nobody crashes": agents, the courier, the
  // plumber and kaRAGan step aside from each other, not only agents among themselves.
  it('steps aside from robots of other groups too, which it gets as obstacles and gives no offset', () => {
    const agent = { x: 0, z: 0, yaw: Math.PI / 2, walking: true };
    const courier = { x: 1, z: 0, yaw: -Math.PI / 2, walking: true };
    const [step] = avoidance([agent], [courier]);
    expect(Math.abs(step.dz)).toBeGreaterThan(0.1);
    expect(Math.abs(step.dx)).toBeLessThan(1e-9);
    expect(avoidance([agent], [])).toEqual([{ dx: 0, dz: 0 }]);
    expect(avoidance([], [courier])).toEqual([]);
  });

  it('a robot standing still keeps still beside another group\'s, unless they overlap', () => {
    expect(avoidance([still(0, 0)], [still(2, 0)])).toEqual([{ dx: 0, dz: 0 }]);
  });

  it('one standing still stays put; the one walking goes round it', () => {
    const offsets = avoidance([still(0, 0), walking(0.2, 0)]);
    expect(offsets[0]).toEqual({ dx: 0, dz: 0 });
    expect(offsets[1].dx).toBeGreaterThan(0);
  });

  // KJC-BUG-0598 (the maintainer, 2026-11-15, with a picture of two robots on one seat).
  it('two standing still on the same spot step apart, half each, and stop overlapping', () => {
    const a = still(0, 0);
    const b = still(0.1, 0);
    const offsets = avoidance([a, b]);
    expect(offsets[0].dx).toBeLessThan(0);
    expect(offsets[1].dx).toBeCloseTo(-offsets[0].dx);
    expect(gap(a, b, offsets)).toBeGreaterThanOrEqual(AVOID.overlap);
  });

  it('robots standing still at their usual distance, as at the seats of a bench, do not move', () => {
    expect(avoidance([still(0, 0), still(1.7, 0)])).toEqual([{ dx: 0, dz: 0 }, { dx: 0, dz: 0 }]);
    expect(avoidance([still(0, 0), still(AVOID.overlap + 0.01, 0)])).toEqual([{ dx: 0, dz: 0 }, { dx: 0, dz: 0 }]);
  });

  it('a crowd never throws one further than a robot\'s width', () => {
    const offsets = avoidance([walking(0, 0), walking(0.05, 0), walking(-0.05, 0), walking(0, 0.05), walking(0, -0.05)]);
    for (const { dx, dz } of offsets) expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(AVOID.radius + 1e-9);
  });
});
