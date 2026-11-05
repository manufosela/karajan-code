// ADR 0047: the factory hall's layout keeps every station on the line and the crew off it.
import { describe, expect, it } from 'vitest';

import { CREW, LINE, PLINTH_WIDTH, SCALE, STATION_X } from '../public/stage/layout.js';

const half = (PLINTH_WIDTH * SCALE.piece) / 2;

describe('factory layout', () => {
  it('has one station per piece of the method, each fully along the line', () => {
    expect(STATION_X).toHaveLength(7);
    for (const x of STATION_X) {
      expect(x - half).toBeGreaterThanOrEqual(LINE.from);
      expect(x + half).toBeLessThanOrEqual(LINE.to);
    }
  });

  it('leaves a gap between neighbouring stations', () => {
    STATION_X.slice(1).forEach((x, i) => expect(x - STATION_X[i]).toBeGreaterThan(2 * half));
  });

  it('puts the crew on the floor beyond the ends of the line', () => {
    for (const { x } of Object.values(CREW)) expect(x < LINE.from || x > LINE.to).toBe(true);
  });
});
