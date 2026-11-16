// KJC-TSK-1461 (ADR 0050, points 2 to 4): a robot carries each card between its lane's
// workshop and the board wall: to pin it, to take it, to bring it back.
import { describe, expect, it } from 'vitest';

import { COURIER_TRIP_MS, COURIER_WALK_MS, PIN_MS, courierAt, noteLines, tripFor } from '../public/stage/courier.js';
import { WALL, WORKSHOP, boothAt } from '../public/stage/layout.js';
import { BUD_MS } from '../public/stage/workers.js';

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

// KJC-BUG-0618 (the maintainer, 2026-11-16): "out of nothing an agent comes out of a workshop, goes to
// the board, takes a task, leaves it at the workshop and vanishes. It cannot appear and disappear out
// of nothing": it comes out of the booth and goes back to it, teleporting as everyone does.
describe('courierAt', () => {
  const trip = { id: 'HU-1', lane: 'feat-x', at: 1000, out: false, back: true };
  const bench = { x: 10, z: WORKSHOP.z - 0.5 };
  const wall = { x: WALL.x, z: WALL.z + 0.6 };
  const door = boothAt(1);
  const stop = (k) => 1000 + BUD_MS + k * COURIER_WALK_MS + (k - 1) * PIN_MS + PIN_MS / 2; // in its k-th stop

  it('teleports in at the booth, never at the workshop, and teleports out there once back', () => {
    expect(courierAt(trip, 1000, xOf)).toMatchObject({ x: door.x, z: door.z, walking: false, size: 0 });
    expect(courierAt(trip, 1000 + BUD_MS + 1, xOf)).toMatchObject({ walking: true, size: 1 });
    const back = courierAt(trip, 1000 + COURIER_TRIP_MS - BUD_MS / 2, xOf);
    expect(back).toMatchObject({ x: door.x, z: door.z, walking: false });
    expect(back.size).toBeLessThan(1);
    expect(courierAt(trip, 1000 + COURIER_TRIP_MS, xOf)).toBeNull();
    expect(courierAt(trip, 999, xOf)).toBeNull();
  });

  it('to take a card it starts: to the wall empty-handed, then to the workshop with the card', () => {
    expect(courierAt(trip, 1000 + BUD_MS + COURIER_WALK_MS / 2, xOf).holding).toBe(false);
    expect(courierAt(trip, stop(1), xOf)).toMatchObject({ ...wall, walking: false });
    expect(courierAt(trip, stop(1) + PIN_MS / 2 + COURIER_WALK_MS / 2, xOf)).toMatchObject({ walking: true, holding: true });
    expect(courierAt(trip, stop(2), xOf)).toMatchObject({ ...bench, walking: false });
    expect(courierAt(trip, stop(2) + PIN_MS / 2 + COURIER_WALK_MS / 2, xOf).holding).toBe(false);
  });

  it('to pin a card: to the workshop first, then to the wall with the card, and back empty-handed', () => {
    const pin = { ...trip, out: true, back: false };
    expect(courierAt(pin, stop(1), xOf)).toMatchObject({ ...bench, walking: false });
    expect(courierAt(pin, stop(1) + PIN_MS / 2 + COURIER_WALK_MS / 2, xOf).holding).toBe(true);
    expect(courierAt(pin, stop(2), xOf)).toMatchObject({ ...wall, walking: false });
    expect(courierAt(pin, stop(2) + PIN_MS / 2 + COURIER_WALK_MS / 2, xOf).holding).toBe(false);
  });

  it('leaves the booth in front of the crew\'s row first, as the hosts do', () => {
    const out = courierAt(trip, 1000 + BUD_MS + 1, xOf);
    expect(out.x).toBeCloseTo(door.x, 1);
    expect(out.z).toBeGreaterThan(door.z - 0.01);
  });
});

describe('noteLines (KJC-TSK-1493)', () => {
  it('splits an id into its prefix and its number, so the number is read whole', () => {
    expect(noteLines('OXP-TSK-0123')).toEqual(['OXP-TSK', '0123']);
    expect(noteLines('HU-3705')).toEqual(['HU', '3705']);
  });

  it('keeps an id with no dash whole, on the big line', () => {
    expect(noteLines('main')).toEqual(['', 'main']);
  });
});
