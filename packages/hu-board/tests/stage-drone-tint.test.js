// KJC-TSK-1713 (the maintainer, 2026-11-21): a piece's pedestal wears its drone's colour.
import { describe, expect, it } from 'vitest';

import { DRONE_TINT, SENTINEL_TINT, plinthTint } from '../public/stage/drone-tint.js';

describe('the pedestal and its drone', () => {
  it('a piece with a drone has its pedestal in its drone colour, the Sentinel in its gold', () => {
    for (const id of Object.keys(DRONE_TINT)) expect(plinthTint(id)).toBe(DRONE_TINT[id]);
    expect(plinthTint('sentinel')).toBe(SENTINEL_TINT);
  });

  it('a piece with no drone keeps the pedestal of its kind', () => {
    expect(plinthTint('review')).toBeNull();
  });
});
