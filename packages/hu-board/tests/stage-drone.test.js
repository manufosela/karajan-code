// KJC-TSK-1547 (asked by the maintainer on 2026-11-11): when a release is published, a drone
// comes down to the "Ready to release" table, lifts its pile and flies away; once it is gone,
// kaWATCHan walks to the version counter and switches it. Pure: the timing and the poses.
import { describe, expect, it } from 'vitest';

import { AWAY_MS, DESCEND_MS, FLIGHT_END_MS, PICK_MS, WALK_MS, counterRelease, droneAt, releaseFlight, tableCards, watcherAt } from '../public/stage/drone.js';
import { CREW, RELEASE_TABLE, VERSION_BOARD } from '../public/stage/layout.js';

const v1 = { tag: 'v1.0.0', at: '2026-11-10T00:00:00Z' };
const v2 = { tag: 'v1.1.0', at: '2026-11-12T00:00:00Z' };
const pile = [{ id: 'HU-1' }, { id: 'HU-2' }];
const flight = releaseFlight(v1, v2, pile, 1000);
const GONE = 1000 + DESCEND_MS + PICK_MS + AWAY_MS;

describe('the drone', () => {
  it('comes down over the table, takes the pile there and flies away until it is gone', () => {
    const over = droneAt(flight, 1000 + DESCEND_MS);
    expect(over).toMatchObject({ x: RELEASE_TABLE.x, z: RELEASE_TABLE.z, carrying: false });
    expect(droneAt(flight, 1000).y).toBeGreaterThan(over.y);
    expect(droneAt(flight, 1000 + DESCEND_MS + PICK_MS).carrying).toBe(true);
    expect(droneAt(flight, GONE - 1).carrying).toBe(true);
    expect(droneAt(flight, GONE)).toBeNull();
    expect(droneAt(null, 0)).toBeNull();
  });

  it('leaves the pile on the table until it takes it, then the table shows what is ready now', () => {
    expect(tableCards(flight, 1000 + DESCEND_MS, [])).toBe(pile);
    expect(tableCards(flight, 1000 + DESCEND_MS + PICK_MS, [])).toEqual([]);
    expect(tableCards(null, 0, pile)).toBe(pile);
  });
});

describe('kaWATCHan and the counter', () => {
  it('waits at its place while the drone flies, walks to the counter, switches it and walks back', () => {
    expect(watcherAt(flight, GONE - 1)).toMatchObject({ x: CREW.watch.x, z: CREW.watch.z, walking: false });
    expect(watcherAt(flight, GONE + WALK_MS / 2).walking).toBe(true);
    const there = watcherAt(flight, GONE + WALK_MS);
    expect(Math.hypot(there.x - VERSION_BOARD.x, there.z - VERSION_BOARD.z)).toBeLessThan(1.2);
    expect(watcherAt(flight, 1000 + FLIGHT_END_MS)).toMatchObject({ x: CREW.watch.x, z: CREW.watch.z, walking: false });
  });

  it('the counter keeps the old release until kaWATCHan switches it', () => {
    expect(counterRelease(flight, GONE + WALK_MS - 1, v2)).toBe(v1);
    expect(counterRelease(flight, 1000 + FLIGHT_END_MS, v2)).toBe(v2);
    expect(counterRelease(null, 0, v2)).toBe(v2);
  });
});
