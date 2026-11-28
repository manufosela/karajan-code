// KJC-TSK-1837 (the maintainer, 2026-11-28: "demasiado scroll horizontal"): narrower workshops. The
// maintainer kept the desks 1.7 m apart for the backpacks (KJC-TSK-1612) and sent kaRAGan in front of
// the host, a little to its left, never behind: beside it, it would stand in the next workshop's belt.
import { describe, expect, it } from 'vitest';

import { BELT } from '../public/stage/conveyor.js';
import { lineWidth } from '../public/stage/line-layout.js';
import { WORKSHOP } from '../public/stage/layout.js';
import { HAND_MS, RAGAN_WALK_MS, raganAt, withRag } from '../public/stage/ragan.js';
import { SEATS, spotOf } from '../public/stage/workers.js';

const ROBOT = 0.45; // half a robot's width at the crew's scale, and some air
const PITCH = WORKSHOP.width + WORKSHOP.gap;

describe('narrower workshops', () => {
  it('makes each workshop 7.6 m wide, 0.4 m from the next', () => {
    expect(WORKSHOP.width).toBeCloseTo(7.6);
    expect(WORKSHOP.gap).toBeCloseTo(0.4);
  });

  it('keeps the desks 1.7 m apart, for the backpacks, and the first agent on its pad', () => {
    for (const [a, b] of SEATS.slice(1).map((s, i) => [SEATS[i], s])) expect(b - a).toBeCloseTo(1.7);
    expect(SEATS[0] - ROBOT).toBeGreaterThanOrEqual(-WORKSHOP.width / 2);
  });

  it('keeps a shorter belt on the pad, still long enough to see its boxes', () => {
    expect(BELT.to).toBeLessThanOrEqual(WORKSHOP.width / 2 - 0.2);
    expect(BELT.to - BELT.from).toBeGreaterThan(0.75);
  });

  it('brings kaRAGan in front of the host, a little to its left and facing it, clear of the next belt', () => {
    const xOf = (lane) => ({ a: 0, b: PITCH })[lane];
    const pose = raganAt(withRag(null, { type: 'rag-answer', lane: 'b' }, 1000), 1000 + RAGAN_WALK_MS + HAND_MS / 2, xOf);
    const host = spotOf('host', xOf('b'), 0, WORKSHOP.z);
    expect(pose.z - host.z).toBeGreaterThanOrEqual(0.6);
    expect(host.x - pose.x).toBeGreaterThan(0.3);
    expect(host.x - pose.x).toBeLessThan(1);
    expect(pose.yaw).toBeCloseTo(Math.atan2(host.x - pose.x, host.z - pose.z));
    expect(pose.x - (xOf('a') + BELT.to)).toBeGreaterThanOrEqual(ROBOT);
  });

  it('takes a five-lane factory from 92.5 m to under 75 m', () => {
    expect(lineWidth(5)).toBeLessThan(75);
  });
});
