// ADR 0048: one workshop per lane at the front, Karajan's posts at the back, no line.
import { describe, expect, it } from 'vitest';

import { CREW, PLINTH_WIDTH, POST, POSTS, SCALE, SENTINEL_POST, STAND, WORKSHOP, hallWidth, postX, workshopX } from '../public/stage/layout.js';

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
