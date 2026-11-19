// ADR 0048: one workshop per lane at the front, Karajan's posts at the back, no line.
import { describe, expect, it } from 'vitest';

import { CREW, PLINTH_WIDTH, POST, POSTS, SCALE, SENTINEL_POST, STAND, WORKSHOP, hallDepth, hallWidth, postX, workshopAt, workshopX } from '../public/stage/layout.js';

describe('factory layout', () => {
  it('centres the row of workshops and never lets two touch', () => {
    expect(workshopX(0, 1)).toBe(0);
    expect(workshopX(0, 3) + workshopX(2, 3)).toBe(0);
    expect(workshopX(1, 3) - workshopX(0, 3)).toBeGreaterThan(WORKSHOP.width);
  });

  it('keeps a post for every piece but the Sentinel, centred and apart, behind the workshops', () => {
    expect(POSTS).toHaveLength(6);
    expect(POSTS).not.toContain('sentinel');
    expect(postX(POSTS[0]) + postX(POSTS.at(-1))).toBe(0);
    expect(postX(POSTS[1]) - postX(POSTS[0])).toBeGreaterThan(PLINTH_WIDTH * SCALE.piece);
    expect(POST.z + PLINTH_WIDTH).toBeLessThan(WORKSHOP.z - WORKSHOP.depth / 2);
  });

  it('raises the Sentinel behind the posts and leaves the crew beyond their ends', () => {
    expect(SENTINEL_POST.z).toBeLessThan(POST.z);
    expect(SENTINEL_POST.height).toBeGreaterThan(1);
    for (const { x } of Object.values(CREW)) expect(Math.abs(x)).toBeGreaterThan(Math.abs(postX(POSTS[0])));
  });

  it('grows the hall with its workshops and always fits the posts', () => {
    expect(hallWidth(8)).toBeGreaterThan(hallWidth(2));
    expect(hallWidth(1)).toBeGreaterThan(2 * Math.abs(postX(POSTS[0])));
  });

  it('keeps kaRAGan beside atril, never between it and the camera, inside the hall (KJC-TSK-1487)', () => {
    // A robot is about 1.7 m wide before its crew scale; atril stands to its side.
    expect(Math.abs(CREW.rag.x - STAND.x)).toBeGreaterThanOrEqual(1.7 * SCALE.crew + 0.4);
    expect(hallWidth(1) / 2).toBeGreaterThan(Math.abs(CREW.rag.x) + 0.5);
  });
});

describe('workshops in rows and columns (KJC-TSK-1488)', () => {
  const cells = (n) => Array.from({ length: n }, (_, i) => workshopAt(i, n));

  it('keeps a factory of up to four lanes in one row, as before', () => {
    for (const n of [1, 2, 4]) expect(cells(n).every((c) => c.z === WORKSHOP.z)).toBe(true);
  });

  // KJC-TSK-1702 (the maintainer, 2026-11-19): "no quiero baile de bloques de trabajo". A slot stands
  // where it stands whatever the number of workshops: four columns, filled from the centre out.
  it('puts each slot at one place, whatever the number of workshops', () => {
    for (let n = 1; n <= 12; n += 1) {
      for (let i = 0; i < n; i += 1) expect(workshopAt(i, n)).toEqual(workshopAt(i, 12));
    }
    expect(workshopAt(0, 1).x + workshopAt(1, 2).x).toBeCloseTo(0);
    expect(new Set(cells(4).map((c) => c.x)).size).toBe(4);
    expect(workshopAt(4, 5).z).toBeGreaterThan(WORKSHOP.z);
    expect(Math.min(...cells(4).map((c) => c.x)) + Math.max(...cells(4).map((c) => c.x))).toBeCloseTo(0);
    expect(hallDepth(5)).toBeGreaterThan(hallDepth(4));
  });

  it('is wide enough for every slot it holds', () => {
    for (const n of [1, 2, 3, 6]) {
      const edge = Math.max(...cells(n).map((c) => Math.abs(c.x))) + WORKSHOP.width / 2;
      expect(hallWidth(n) / 2).toBeGreaterThanOrEqual(edge);
    }
  });

  it('never lets two workshops touch, side by side or front to back', () => {
    const grid = cells(13);
    for (const a of grid) {
      for (const b of grid) {
        if (a === b) continue;
        const apart = Math.abs(a.x - b.x) > WORKSHOP.width || Math.abs(a.z - b.z) > WORKSHOP.depth + 1;
        expect(apart).toBe(true);
      }
    }
  });
});
