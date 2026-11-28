// KJC-TSK-1826 (ADR "kj stage en una línea", accepted 2026-11-27): "la cinta de cada mesa y su
// fontanero se quedan, con la cinta a un lado de la mesa". The belt runs left to right on the right of
// the desks, at their depth, so from the camera in front nothing is behind the desks; it carries the
// work on toward the gates and the rest of the line.
import { describe, expect, it } from 'vitest';

import { BELT } from '../public/stage/conveyor.js';
import { deskParts } from '../public/stage/desk-layout.js';
import { WORKSHOP } from '../public/stage/layout.js';
import { plumberSpot } from '../public/stage/plumbers.js';
import { SEATS, spotOf } from '../public/stage/workers.js';

const ROBOT = 0.45; // half a robot's width at the crew's scale, and some air
const desks = deskParts();
const corners = desks.flatMap((d) => [-1, 1].flatMap((a) => [-1, 1].map((c) => ({
  x: d.x + a * (d.depth / 2) * Math.sin(d.yaw) + c * (d.width / 2) * Math.cos(d.yaw),
  z: d.z + a * (d.depth / 2) * Math.cos(d.yaw) - c * (d.width / 2) * Math.sin(d.yaw),
}))));
const robots = SEATS.map((_, seat) => spotOf('host', 0, seat, 0));

describe('the belt beside the desks', () => {
  it('runs left to right on the right of every desk and every agent, long enough to see its boxes', () => {
    const rightmost = Math.max(...corners.map((c) => c.x), ...robots.map((r) => r.x + ROBOT));
    expect(BELT.from).toBeGreaterThan(rightmost + 0.2);
    expect(BELT.to - BELT.from).toBeGreaterThanOrEqual(1.5);
  });

  it('stays inside its workshop', () => {
    expect(BELT.from).toBeGreaterThan(-WORKSHOP.width / 2);
    expect(BELT.to).toBeLessThanOrEqual(WORKSHOP.width / 2 - 0.2);
  });

  it('stands at the desks\' depth: beside them, not behind', () => {
    const zs = [...corners.map((c) => c.z), ...robots.map((r) => r.z)];
    expect(BELT.z).toBeGreaterThanOrEqual(Math.min(...zs) - 0.3);
    expect(BELT.z).toBeLessThanOrEqual(Math.max(...zs) + 0.3);
  });

  it('keeps the agents\' seats evenly apart, all of them left of the belt', () => {
    for (const [a, b] of SEATS.slice(1).map((s, i) => [SEATS[i], s])) expect(b - a).toBeCloseTo(SEATS[1] - SEATS[0]);
    expect(Math.min(...SEATS) - ROBOT).toBeGreaterThan(-WORKSHOP.width / 2);
  });

  it('sends the plumber behind the low belt, facing it and the camera, within its length, clear of the desks', () => {
    const spot = plumberSpot(10, 2);
    expect(spot.z).toBeLessThan(2 + BELT.z);
    expect(spot.x - 10 - ROBOT).toBeGreaterThan(Math.max(...corners.map((c) => c.x)));
    expect(spot.x).toBeGreaterThan(10 + BELT.from);
    expect(spot.x).toBeLessThan(10 + BELT.to);
  });
});
