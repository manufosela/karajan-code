// KJC-TSK-1639 (the maintainer, 2026-11-15): "a workshop stays on 'pipeline failed'… when it runs
// it looks like it goes on its own… can we show something?" → "a conveyor belt; if it fails it
// turns red". A lane's pipeline as a belt at the back of its workshop, ending at its git gates.
import { describe, expect, it } from 'vitest';

import { BELT, BELT_MS, beltLook, boxesAt } from '../public/stage/conveyor.js';
import { WORKSHOP } from '../public/stage/layout.js';

describe('the belt of a lane', () => {
  it('runs along the back of the workshop, inside its width, and ends at its git gates', () => {
    expect(BELT.from).toBeGreaterThan(-WORKSHOP.width / 2);
    expect(BELT.to).toBeLessThan(WORKSHOP.width / 2);
    expect(BELT.to).toBeCloseTo(WORKSHOP.width / 2 - 0.9); // the gates (hall.js)
    expect(BELT.z).toBeLessThan(-WORKSHOP.depth / 2);
  });

  it('shows only while the lane has an open pull request: running moves, failed and passed stand still', () => {
    expect(beltLook(null)).toBeNull();
    expect(beltLook('unknown')).toBeNull();
    expect(beltLook('running')).toEqual({ tone: 'running', moving: true });
    expect(beltLook('failed')).toEqual({ tone: 'failed', moving: false });
    expect(beltLook('passed')).toEqual({ tone: 'passed', moving: false });
  });
});

describe('boxesAt', () => {
  const span = BELT.to - BELT.from;

  it('running, its boxes ride toward the gates, evenly apart, and come round again', () => {
    const now = boxesAt('running', 0);
    expect(now).toHaveLength(BELT.boxes);
    for (const x of now) expect(x).toBeGreaterThanOrEqual(BELT.from);
    const later = boxesAt('running', BELT_MS / 10);
    expect(later[0] - now[0]).toBeCloseTo(span / 10);
    expect(boxesAt('running', BELT_MS)).toEqual(now.map((x) => expect.closeTo(x, 6)));
    const sorted = now.toSorted((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeCloseTo(span / BELT.boxes);
  });

  it('failed, they stop where they are, whatever the time', () => {
    expect(boxesAt('failed', 12_345)).toEqual(boxesAt('failed', 0));
    expect(boxesAt('failed', 0)).toHaveLength(BELT.boxes);
  });

  it('passed, one box waits at the gates; without a pull request there are none', () => {
    const [box] = boxesAt('passed', 999);
    expect(boxesAt('passed', 999)).toHaveLength(1);
    expect(BELT.to - box).toBeLessThan(0.5);
    expect(boxesAt(null, 0)).toEqual([]);
  });
});
