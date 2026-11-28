// KJC-BUG-0689 (the maintainer, 2026-11-28: "los bloques en movimiento han perdido mucho, van para
// delante y atrás, todos juntos"): on the shorter belt of the narrower workshops three boxes ran
// stuck together and, at the end, all jumped back at once. They ride apart now, each growing in at
// the start of the belt and shrinking out at its end.
import { describe, expect, it } from 'vitest';

import { BELT, BELT_MS, boxScale, boxesAt } from '../public/stage/conveyor.js';

const span = BELT.to - BELT.from;

describe('the boxes on the belt', () => {
  it('ride with room between them, at least half a box', () => {
    expect(span / BELT.boxes).toBeGreaterThanOrEqual(BELT.box * 1.5);
    const xs = boxesAt('running', BELT_MS / 3).toSorted((a, b) => a - b);
    for (const [a, b] of xs.slice(1).map((x, i) => [xs[i], x])) expect(b - a).toBeGreaterThanOrEqual(BELT.box * 1.5);
  });

  it('grow in at the start and shrink out at the end, whole in between', () => {
    expect(boxScale(BELT.from)).toBeCloseTo(0);
    expect(boxScale(BELT.to)).toBeCloseTo(0);
    expect(boxScale((BELT.from + BELT.to) / 2)).toBe(1);
    expect(boxScale(BELT.from + span / 8)).toBeGreaterThan(0);
    expect(boxScale(BELT.from + span / 8)).toBeLessThan(1);
  });

  it('never shows a box jumping back whole: where one wraps it is gone', () => {
    for (let t = 0; t < BELT_MS; t += BELT_MS / 200) {
      const xs = boxesAt('running', t);
      for (const x of xs) if (x - BELT.from < 0.02) expect(boxScale(x)).toBeLessThan(0.2);
    }
  });

  it('keeps the box at the gates whole when the pipeline passed', () => {
    const [box] = boxesAt('passed', 999);
    expect(boxScale(box)).toBe(1);
  });
});
