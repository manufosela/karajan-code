// KJC-TSK-1701 (the maintainer, 2026-11-19): "TDD, ledger, steward... should be drones: fly, stand over
// the agent, let a rope down with a camera, pick it up and go back to the base". The piece stays on its
// post (the base) and sends its drone along the visit piece-visit.js already times.
import { describe, expect, it } from 'vitest';

import { CABLE_MAX, CRUISE_Y, DOCK_Y, HOVER_Y, pieceDroneAt as droneAt } from '../public/stage/piece-drone.js';
import { PIECE_WALK_MS, VISIT_SPOTS, withVisit } from '../public/stage/piece-visit.js';

const home = { x: 2, z: -3 };
const xOf = () => 10;
const zOf = () => 4;
const over = { x: 10 + VISIT_SPOTS.tdd.dx, z: 4 + VISIT_SPOTS.tdd.dz };
const visit = withVisit({}, { type: 'method-check', piece: 'tdd', lane: 'a', outcome: 'pass' }, 1000).tdd;
const at = (now, v = visit) => droneAt(v, now, home, xOf, zOf);

describe('droneAt', () => {
  it('rests docked on its piece with no visit, and before and after one', () => {
    for (const pose of [droneAt(undefined, 0, home, xOf, zOf), at(999), at(visit.until + PIECE_WALK_MS)]) {
      expect(pose).toMatchObject({ x: home.x, y: DOCK_Y, z: home.z, cable: 0, flying: false });
    }
  });

  it('flies over the hall, higher than it hovers, to stand over its spot of the workshop', () => {
    const mid = at(1000 + PIECE_WALK_MS / 2);
    expect(mid.flying).toBe(true);
    expect(mid.y).toBeGreaterThan(HOVER_Y);
    expect(mid.y).toBeLessThanOrEqual(CRUISE_Y + 1e-9);
    expect(at(1000 + PIECE_WALK_MS)).toMatchObject({ x: over.x, y: HOVER_Y, z: over.z });
  });

  it('lets its camera down on the rope while it hovers, and takes it up before it goes', () => {
    const arrive = 1000 + PIECE_WALK_MS;
    expect(at(arrive).cable).toBe(0);
    const middle = at((arrive + visit.until) / 2);
    expect(middle.cable).toBe(CABLE_MAX);
    expect(at(visit.until).cable).toBe(0);
    expect(at(visit.until + PIECE_WALK_MS / 2)).toMatchObject({ flying: true, cable: 0 });
  });

  it('called elsewhere on its way, it turns from where it is, not from its base', () => {
    const t = 1000 + PIECE_WALK_MS / 2;
    const now = at(t);
    const again = withVisit({ tdd: visit }, { type: 'method-check', piece: 'tdd', lane: 'b', outcome: 'pass' }, t).tdd;
    const start = droneAt(again, t, home, (lane) => (lane === 'b' ? -10 : 10), zOf);
    expect(start.x).toBeCloseTo(now.x);
    expect(start.z).toBeCloseTo(now.z);
  });
});
