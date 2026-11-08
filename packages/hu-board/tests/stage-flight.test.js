// KJC-TSK-1455 (ADR 0049): a click on a factory of the map flies the camera to it.
import { describe, expect, it } from 'vitest';

import { FLIGHT_MS, flightAt, groundAt, lotAt } from '../public/stage/flight.js';

describe('flightAt', () => {
  const flight = { from: { x: 0, z: 0, zoom: 1 }, to: { x: 10, z: -20, zoom: 0.2 }, start: 1000 };

  it('has nothing to say without a flight', () => {
    expect(flightAt(null, 5)).toBeNull();
  });

  it('leaves from where the camera was and lands where it was sent', () => {
    expect(flightAt(flight, 1000)).toEqual({ x: 0, z: 0, zoom: 1, done: false });
    expect(flightAt(flight, 1000 + FLIGHT_MS)).toEqual({ x: 10, z: -20, zoom: 0.2, done: true });
    expect(flightAt(flight, 1e9).done).toBe(true);
  });

  it('eases: halfway in time is halfway in space, slower at both ends', () => {
    const half = flightAt(flight, 1000 + FLIGHT_MS / 2);
    expect(half.x).toBeCloseTo(5);
    expect(flightAt(flight, 1000 + FLIGHT_MS / 10).x).toBeLessThan(1);
  });
});

describe('groundAt', () => {
  it('is where a ray from the camera meets the floor', () => {
    expect(groundAt({ x: 0, y: 10, z: 10 }, { x: 0, y: -1, z: -1 })).toEqual({ x: 0, z: 0 });
    expect(groundAt({ x: 2, y: 4, z: 0 }, { x: 1, y: -2, z: 0 })).toEqual({ x: 4, z: 0 });
  });

  it('is nowhere when the ray looks up or along the floor', () => {
    expect(groundAt({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    expect(groundAt({ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });
});

describe('lotAt', () => {
  const origins = [{ x: -15, z: 0 }, { x: 15, z: 0 }];
  const size = { width: 30, depth: 20 };

  it('names the factory whose floor holds the point (the aisle is on no floor)', () => {
    expect(lotAt({ x: -15, z: 3 }, origins, size, 4)).toBe(0);
    expect(lotAt({ x: 20, z: -1.75 }, origins, size, 4)).toBe(1);
    expect(lotAt({ x: 0, z: 0 }, origins, size, 4)).toBe(-1);
    expect(lotAt(null, origins, size, 4)).toBe(-1);
  });
});
