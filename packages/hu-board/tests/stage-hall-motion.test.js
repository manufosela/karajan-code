// KJC-BUG-0623 (the maintainer, 2026-11-16): "the workshops vanish at once and there is an odd jump
// as they go and the rest move. It should be softer: it fades, leaving its gap; then each block slides
// gently into its place".
import { describe, expect, it } from 'vitest';

import { FADE_MS, SLIDE_MS, leaveSlot, opacityAt, slideAt, takeSlot } from '../public/stage/hall-motion.js';

// KJC-BUG-0633 (the maintainer, 2026-11-17): "the 2nd goes to 1st… and goes back to its place 2nd".
// KJC-TSK-1702 (2026-11-19): "no quiero baile de bloques de trabajo": each workshop keeps its slot;
// one that goes leaves a gap that waits for the next one, and the others never move.
describe('slots', () => {
  it('a new lane takes the first gap, else the end', () => {
    const last = new Map();
    expect(takeSlot([], last, 'A')).toEqual(['A']);
    expect(takeSlot(['A', null, 'C'], last, 'D')).toEqual(['A', 'D', 'C']);
    expect(takeSlot(['A', 'B'], last, 'D')).toEqual(['A', 'B', 'D']);
  });

  it('one that goes leaves its gap and nobody else moves; trailing gaps close', () => {
    const last = new Map();
    expect(leaveSlot(['A', 'B', 'C'], last, 'B')).toEqual(['A', null, 'C']);
    expect(leaveSlot(['A', null, 'C'], last, 'C')).toEqual(['A']);
  });

  it('one that comes back takes its old slot when it is free', () => {
    const last = new Map();
    const gone = leaveSlot(['A', 'B', 'C'], last, 'B');
    expect(takeSlot(gone, last, 'B')).toEqual(['A', 'B', 'C']);
    const taken = takeSlot(gone, last, 'D');
    expect(takeSlot(taken, last, 'B')).toEqual(['A', 'D', 'C', 'B']);
  });

  it('a lane already in place stays as it is', () => {
    const slots = ['A', 'B'];
    expect(takeSlot(slots, new Map(), 'B')).toBe(slots);
  });
});

describe('opacityAt', () => {
  it('a workshop that leaves fades out over FADE_MS, and is then gone', () => {
    const leaving = { at: 1000 };
    expect(opacityAt({ leaving, born: 0 }, 1000)).toBe(1);
    expect(opacityAt({ leaving, born: 0 }, 1000 + FADE_MS / 2)).toBeCloseTo(0.5);
    expect(opacityAt({ leaving, born: 0 }, 1000 + FADE_MS)).toBe(0);
  });

  it('a new workshop fades in, and one that stays is whole', () => {
    expect(opacityAt({ born: 1000 }, 1000)).toBe(0);
    expect(opacityAt({ born: 1000 }, 1000 + FADE_MS / 2)).toBeCloseTo(0.5);
    expect(opacityAt({ born: 1000 }, 1000 + FADE_MS)).toBe(1);
    expect(opacityAt({ born: -Infinity }, 5)).toBe(1);
  });
});

describe('slideAt', () => {
  const move = { from: { x: 0, z: 0 }, to: { x: 10, z: 4 }, at: 2000 };

  it('slides from where it stood to its new place over SLIDE_MS, slow at both ends', () => {
    expect(slideAt(move, 2000)).toEqual({ x: 0, z: 0 });
    const half = slideAt(move, 2000 + SLIDE_MS / 2);
    expect(half.x).toBeCloseTo(5);
    expect(half.z).toBeCloseTo(2);
    expect(slideAt(move, 2000 + SLIDE_MS / 10).x).toBeLessThan(1); // eases in
    expect(slideAt(move, 2000 + SLIDE_MS)).toEqual({ x: 10, z: 4 });
    expect(slideAt(move, 2000 + 5 * SLIDE_MS)).toEqual({ x: 10, z: 4 });
  });

  it('no move: nothing to slide', () => {
    expect(slideAt(null, 0)).toBeNull();
  });
});
