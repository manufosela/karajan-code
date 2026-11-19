// KJC-TSK-1704 (the maintainer, 2026-11-19): "los bloques de trabajo, donde hay agentes, deban estar
// donde están y el resto en otro lado aparte". A workshop with nobody in it for a while goes to the
// warehouse; one with an agent, or its pipeline running, comes back. Main never leaves the hall.
import { describe, expect, it } from 'vitest';

import { RACK, STORE_AFTER_MS, rackBays, rackSpot, storedNow } from '../public/stage/warehouse.js';
import { WORKSHOP, workshopAt } from '../public/stage/layout.js';

describe('the warehouse rack', () => {
  it('stands right of every column of the hall, clear of it', () => {
    const right = Math.max(...Array.from({ length: 4 }, (_, i) => workshopAt(i, 4).x)) + WORKSHOP.width / 2;
    expect(RACK.x - RACK.w / 2).toBeGreaterThan(right + 1.5);
  });

  it('stacks the slabs shelf over shelf, then bay after bay, none on another', () => {
    const spots = Array.from({ length: 9 }, (_, i) => rackSpot(i));
    expect(spots.slice(0, RACK.high).every((s) => s.z === spots[0].z)).toBe(true);
    expect(spots[1].y - spots[0].y).toBeGreaterThan(RACK.h);
    expect(spots[RACK.high].z).toBeGreaterThan(spots[0].z);
    expect(new Set(spots.map((s) => `${s.y}|${s.z}`)).size).toBe(9);
    expect(rackBays(0)).toBe(0);
    expect(rackBays(5)).toBe(2);
  });
});

const lanes = ['main', 'a', 'b', 'c'];

describe('storedNow', () => {
  it('on opening, every idle lane but main is already stored', () => {
    expect([...storedNow(lanes, new Set(['b']), new Set(), null, 0).store].toSorted()).toEqual(['a', 'c']);
  });

  it('a lane that goes idle is stored only after STORE_AFTER_MS idle on end', () => {
    let state = storedNow(lanes, new Set(lanes), new Set(), new Map(), 0);
    expect(state.store.size).toBe(0);
    state = storedNow(lanes, new Set(['b']), state.store, state.since, 1000);
    expect(state.store.size).toBe(0);
    state = storedNow(lanes, new Set(['b']), state.store, state.since, 1000 + STORE_AFTER_MS - 1);
    expect(state.store.size).toBe(0);
    state = storedNow(lanes, new Set(['b']), state.store, state.since, 1000 + STORE_AFTER_MS);
    expect([...state.store].toSorted()).toEqual(['a', 'c']);
  });

  it('a pause shorter than that stores nothing, and the clock starts again', () => {
    let state = storedNow(lanes, new Set(lanes), new Set(), new Map(), 0);
    state = storedNow(lanes, new Set(['main', 'b', 'c']), state.store, state.since, 1000);
    state = storedNow(lanes, new Set(lanes), state.store, state.since, 2000);
    state = storedNow(lanes, new Set(['main', 'b', 'c']), state.store, state.since, 3000);
    state = storedNow(lanes, new Set(['main', 'b', 'c']), state.store, state.since, 1000 + STORE_AFTER_MS);
    expect(state.store.has('a')).toBe(false);
  });

  it('a stored lane with an agent again comes back at once', () => {
    const opened = storedNow(lanes, new Set(), new Set(), null, 0);
    expect(opened.store.has('a')).toBe(true);
    const back = storedNow(lanes, new Set(['a']), opened.store, opened.since, 10);
    expect(back.store.has('a')).toBe(false);
  });
});
