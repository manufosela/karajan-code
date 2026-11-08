// KJC-TSK-1461 (ADR 0050, points 2 to 4): a robot carries each card between its lane's
// workshop and the board wall: to pin it, to take it, to bring it back.
import { describe, expect, it } from 'vitest';

import { COURIER_WALK_MS, PIN_MS, courierAt, tripFor } from '../public/stage/courier.js';
import { WALL, WORKSHOP } from '../public/stage/layout.js';

const card = (over) => ({ type: 'card', at: 'x', action: 'add', id: 'HU-1', title: 'Login', status: 'pending', queued: false, lane: 'feat-x', ...over });
const xOf = (lane) => (lane === 'feat-x' ? 10 : 0);

describe('tripFor', () => {
  it('pins a new card and brings a finished one back: it carries the card to the wall', () => {
    expect(tripFor(card(), 5)).toEqual({ id: 'HU-1', lane: 'feat-x', at: 5, out: true, back: false });
    expect(tripFor(card({ action: 'move', status: 'done' }), 5)).toMatchObject({ out: true, back: false });
  });

  it('takes a card it starts: it walks to the wall empty-handed and carries it back', () => {
    expect(tripFor(card({ action: 'move', status: 'running' }), 5)).toMatchObject({ out: false, back: true });
  });

  it('sends no robot for a queued move, a card sent back to do, a failed or a skipped one', () => {
    for (const over of [{ action: 'move', status: 'done', queued: true }, { action: 'move', status: 'pending' }, { action: 'move', status: 'failed' }, { action: 'move', status: 'skipped' }]) {
      expect(tripFor(card(over), 5)).toBeNull();
    }
    expect(tripFor({ type: 'sentinel-deny' }, 5)).toBeNull();
  });
});

describe('courierAt', () => {
  const trip = { id: 'HU-1', lane: 'feat-x', at: 1000, out: false, back: true };
  const bench = { x: 10, z: WORKSHOP.z - 0.5 };
  const wall = { x: WALL.x, z: WALL.z + 0.6 };

  it('leaves the workshop of its lane, stops at the wall and comes back, then is gone', () => {
    expect(courierAt(trip, 1000, xOf)).toMatchObject({ ...bench, walking: true, holding: false });
    expect(courierAt(trip, 1000 + COURIER_WALK_MS + PIN_MS / 2, xOf)).toMatchObject({ ...wall, walking: false });
    const half = courierAt(trip, 1000 + 1.5 * COURIER_WALK_MS + PIN_MS, xOf);
    expect(half.x).toBeCloseTo((bench.x + wall.x) / 2);
    expect(half).toMatchObject({ walking: true, holding: true });
    expect(courierAt(trip, 1000 + 2 * COURIER_WALK_MS + PIN_MS, xOf)).toBeNull();
    expect(courierAt(trip, 999, xOf)).toBeNull();
  });

  it('holds the card on the way out when it carries it to the wall, and hands it over there', () => {
    const pin = { ...trip, out: true, back: false };
    expect(courierAt(pin, 1000 + COURIER_WALK_MS / 2, xOf).holding).toBe(true);
    expect(courierAt(pin, 1000 + COURIER_WALK_MS + PIN_MS + 10, xOf).holding).toBe(false);
  });
});
