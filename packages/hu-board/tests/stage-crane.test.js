// KJC-TSK-1705 (the maintainer, 2026-11-19): "pensar algo para que tenga sentido que se muevan... no
// quiero que aparezcan y desaparezcan bloques". A crane lifts a workshop off its shelf, carries it over
// the hall growing to its size and lowers it into its slot; and the way back, shrinking.
import { describe, expect, it } from 'vitest';

import { CRANE, CRANE_MS, craneAt } from '../public/stage/crane.js';

const shelf = { x: 18, y: 1.2, z: 3, scale: CRANE.small };
const slot = { x: -3.7, y: 0, z: 2.2, scale: 1 };
const trip = { from: shelf, to: slot, at: 1000 };

describe('craneAt', () => {
  it('starts where the workshop stands and ends in its place, then is done', () => {
    expect(craneAt(trip, 1000)).toMatchObject(shelf);
    expect(craneAt(trip, 1000 + CRANE_MS - 1)).toMatchObject({ x: slot.x, z: slot.z });
    expect(craneAt(trip, 1000 + CRANE_MS - 1).y).toBeCloseTo(0, 1);
    expect(craneAt(trip, 1000 + CRANE_MS)).toBeNull();
  });

  it('lifts it first, straight up, then carries it over everyone at the top', () => {
    const lifting = craneAt(trip, 1000 + CRANE.liftMs / 2);
    expect(lifting).toMatchObject({ x: shelf.x, z: shelf.z });
    expect(lifting.y).toBeGreaterThan(shelf.y);
    const carrying = craneAt(trip, 1000 + CRANE.liftMs + CRANE.carryMs / 2);
    expect(carrying.y).toBe(CRANE.top);
    expect(carrying.x).toBeLessThan(shelf.x);
    expect(carrying.x).toBeGreaterThan(slot.x);
  });

  it('grows from its slab to its size on the way in, and shrinks on the way out', () => {
    const mid = 1000 + CRANE.liftMs + CRANE.carryMs / 2;
    const growing = craneAt(trip, mid).scale;
    expect(growing).toBeGreaterThan(CRANE.small);
    expect(growing).toBeLessThan(1);
    const back = { from: slot, to: shelf, at: 1000 };
    expect(craneAt(back, 1000 + CRANE_MS - 1).scale).toBeCloseTo(CRANE.small);
  });

  it('nothing before its trip starts', () => {
    expect(craneAt(trip, 999)).toMatchObject(shelf);
  });
});
