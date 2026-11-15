// KJC-TSK-1641 (the maintainer, 2026-11-15): "a pipeline, so show a plumber?" Its own colours:
// a gray body, blue overalls, a yellow hard hat and a steel wrench; no red anywhere.
import { describe, expect, it } from 'vitest';

import { PLUMBER } from '../public/stage/plumber-look.js';

const rgb = (hex) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
const reddish = (hex) => { const [r, g, b] = rgb(hex); return r > 150 && r > 1.6 * g && r > 1.6 * b; };

describe('the plumber\'s colours', () => {
  it('a gray body: its channels nearly equal', () => {
    const [r, g, b] = rgb(PLUMBER.body);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24);
  });

  it('blue overalls and a yellow hard hat, and nothing red', () => {
    const [r, , b] = rgb(PLUMBER.overalls);
    expect(b).toBeGreaterThan(r);
    const [hr, hg, hb] = rgb(PLUMBER.hat);
    expect(hr).toBeGreaterThan(hb);
    expect(hg).toBeGreaterThan(hb);
    for (const hex of Object.values(PLUMBER)) expect(reddish(hex)).toBe(false);
  });
});
