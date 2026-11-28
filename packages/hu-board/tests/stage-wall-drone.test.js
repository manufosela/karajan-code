// KJC-TSK-1832 (ADR "kj stage en una línea", decision 5, accepted 2026-11-27): "el muro tiene un solo
// dron, grande y bien definido, que lleva y recoge las tarjetas a la vista. Fuera los mensajeros."
// One drone docked over the task wall takes every card errand, one after another: it flies to where
// the card is, takes it, flies it to where it goes, leaves it and comes back, always in sight.
import { describe, expect, it } from 'vitest';

import { DOCK, NOTE, WALL_DRONE_TRIP_MS, droneTrips, tripFor, wallDroneAt } from '../public/stage/wall-drone.js';
import { WALL } from '../public/stage/layout.js';

const xOf = (lane) => ({ main: -6, a: 6 })[lane];
const zOf = () => 2;
const card = (o) => ({ type: 'card', id: 'HU-1', lane: 'a', ...o });

describe('the errands of the cards', () => {
  it('a new card or a done one goes to the wall; a card started comes from it; others make no trip', () => {
    expect(tripFor(card({ action: 'add' }), 5)).toEqual({ id: 'HU-1', lane: 'a', at: 5, out: true, back: false });
    expect(tripFor(card({ action: 'move', status: 'done' }), 5)).toMatchObject({ out: true });
    expect(tripFor(card({ action: 'move', status: 'running' }), 5)).toMatchObject({ out: false, back: true });
    expect(tripFor(card({ action: 'move', status: 'pending' }), 5)).toBeNull();
    expect(tripFor(card({ action: 'add', queued: true }), 5)).toBeNull();
    expect(tripFor({ type: 'other' }, 5)).toBeNull();
  });

  it('one drone: a trip that arrives while it is busy waits for the one before to end', () => {
    const trips = droneTrips([tripFor(card({ action: 'add' }), 0), tripFor(card({ id: 'HU-2', action: 'add' }), 100)]);
    expect(trips[0].start).toBe(0);
    expect(trips[1].start).toBe(WALL_DRONE_TRIP_MS);
    expect(droneTrips([tripFor(card({ action: 'add' }), 0), tripFor(card({ action: 'add' }), 3 * WALL_DRONE_TRIP_MS)])[1].start).toBe(3 * WALL_DRONE_TRIP_MS);
  });

  // The stage keeps the scheduled trips and drops the finished ones each frame: scheduling them again
  // must not move a trip under way back to when its card event came (the drone would jump).
  it('keeps a scheduled trip\'s start once the one before it is gone', () => {
    const [, second] = droneTrips([tripFor(card({ action: 'add' }), 0), tripFor(card({ id: 'HU-2', action: 'add' }), 100)]);
    expect(droneTrips([second])[0].start).toBe(WALL_DRONE_TRIP_MS);
  });
});

describe('wallDroneAt', () => {
  const [toWall] = droneTrips([tripFor(card({ action: 'add' }), 0)]);
  const [fromWall] = droneTrips([tripFor(card({ action: 'move', status: 'running' }), 0)]);

  it('waits docked over the wall, in sight, when it has nothing to carry', () => {
    expect(wallDroneAt([], 50, xOf, zOf)).toMatchObject({ ...DOCK, carrying: null });
    expect(DOCK.x).toBeCloseTo(WALL.x);
    expect(DOCK.y).toBeGreaterThan(WALL.y + WALL.height);
  });

  it('takes a new card from its lane to the wall, carrying it in between', () => {
    const mid = wallDroneAt([toWall], WALL_DRONE_TRIP_MS / 2, xOf, zOf);
    expect(mid.carrying).toBe('HU-1');
    const picks = Array.from({ length: 100 }, (_, i) => wallDroneAt([toWall], (i / 100) * WALL_DRONE_TRIP_MS, xOf, zOf));
    const low = picks.filter((p) => p.y < 2);
    expect(low.some((p) => Math.abs(p.x - xOf('a')) < 0.5)).toBe(true); // down at the lane
    expect(wallDroneAt([toWall], WALL_DRONE_TRIP_MS, xOf, zOf)).toMatchObject({ ...DOCK, carrying: null });
  });

  it('brings a started card from the wall down to its lane', () => {
    const picks = Array.from({ length: 100 }, (_, i) => wallDroneAt([fromWall], (i / 100) * WALL_DRONE_TRIP_MS, xOf, zOf));
    const atLane = picks.findIndex((p) => p.y < 2 && Math.abs(p.x - xOf('a')) < 0.5);
    expect(atLane).toBeGreaterThan(0);
    expect(picks[atLane - 1].carrying).toBe('HU-1');
    expect(picks.at(-1).carrying).toBeNull();
  });

  // #5029 (codex): down at the lane, the note hanging under it went half into the floor.
  it('keeps the card it carries whole above the floor', () => {
    for (const trip of [toWall, fromWall]) {
      for (let t = 0; t <= WALL_DRONE_TRIP_MS; t += 20) {
        const at = wallDroneAt([trip], t, xOf, zOf);
        if (at.carrying) expect(at.y - NOTE.below - NOTE.height / 2, `t=${t}`).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it('never jumps: from one moment to the next it moves a short way, and never goes through the floor', () => {
    const step = 20;
    let last = wallDroneAt([toWall], 0, xOf, zOf);
    for (let t = step; t <= WALL_DRONE_TRIP_MS; t += step) {
      const now = wallDroneAt([toWall], t, xOf, zOf);
      expect(Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z), `t=${t}`).toBeLessThan(0.5);
      expect(now.y).toBeGreaterThan(0.5);
      last = now;
    }
  });
});
