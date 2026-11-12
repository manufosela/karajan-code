// KJC-TSK-1550 (ADR 0054, slice 3): a teammate's factory says how old its last news is and goes
// dim once it is older than DIM_AFTER_MS (an open question of the ADR: 30 min to start with).
import { describe, expect, it } from 'vitest';

import { DIM_AFTER_MS, ageLabel, isStale } from '../public/stage/team-map.js';

const at = '2026-11-12T10:00:00Z';
const later = (ms) => Date.parse(at) + ms;

describe('the age of a teammate\'s factory', () => {
  it('says how long ago the board saw it, in minutes, hours or days', () => {
    expect(ageLabel(at, later(20 * 1000))).toBe('just now');
    expect(ageLabel(at, later(12 * 60 * 1000))).toBe('12 min ago');
    expect(ageLabel(at, later(3 * 60 * 60 * 1000))).toBe('3 h ago');
    expect(ageLabel(at, later(2 * 24 * 60 * 60 * 1000))).toBe('2 d ago');
    expect(ageLabel('nonsense', later(0))).toBe('age unknown');
  });

  it('goes dim once its news is older than the limit, and an unknown age is dim', () => {
    expect(isStale(at, later(DIM_AFTER_MS - 1))).toBe(false);
    expect(isStale(at, later(DIM_AFTER_MS))).toBe(true);
    expect(isStale('nonsense', later(0))).toBe(true);
  });
});
