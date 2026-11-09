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
    for (const n of [1, 2, 4]) {
      expect(cells(n).every((c) => c.z === WORKSHOP.z)).toBe(true);
      expect(cells(n).map((c) => c.x)).toEqual(cells(n).map((_, i) => workshopX(i, n)));
    }
  });

  it('lays a big factory out wider than deep, centred, the first row at the front of the posts', () => {
    const grid = cells(25);
    const rows = new Set(grid.map((c) => c.z)).size;
    const columns = new Set(grid.map((c) => c.x)).size;
    expect(columns).toBeGreaterThan(rows);
    expect(rows).toBeGreaterThan(1);
    expect(Math.min(...grid.map((c) => c.z))).toBe(WORKSHOP.z);
    expect(Math.min(...grid.map((c) => c.x)) + Math.max(...grid.map((c) => c.x))).toBeCloseTo(0);
    expect(hallDepth(25)).toBeGreaterThan(hallDepth(4));
    expect(hallWidth(25)).toBeLessThan(25 * (WORKSHOP.width + WORKSHOP.gap) / 2);
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
