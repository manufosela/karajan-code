// KJC-TSK-1420 (ADR 0047): the crew is always busy, as a pure function of time.
import { describe, expect, it } from 'vitest';

import { LINES, ROUTES, bubbleAt, periodOf, poseAt } from '../public/stage/ambient.js';
import { LINE } from '../public/stage/layout.js';

const route = [{ x: 0, z: 0, pause: 1 }, { x: 0, z: 2.4, pause: 1 }];

describe('poseAt', () => {
  it('starts standing on the first waypoint', () => {
    expect(poseAt(route, 0)).toMatchObject({ x: 0, z: 0, walking: false });
  });

  it('walks between waypoints facing where it goes', () => {
    const pose = poseAt(route, 2); // 1 s of pause, then 1 s at 1.2 m/s
    expect(pose.walking).toBe(true);
    expect(pose.z).toBeCloseTo(1.2);
    expect(pose.yaw).toBeCloseTo(0);
  });

  it('closes the loop back to the first waypoint', () => {
    expect(periodOf(route)).toBeCloseTo(6);
    expect(poseAt(route, 6)).toMatchObject({ x: 0, z: 0, walking: false });
    expect(poseAt(route, 5).yaw).toBeCloseTo(Math.PI);
  });
});

describe('ROUTES', () => {
  const clear = LINE.width / 2 + 0.5;
  it.each(Object.entries(ROUTES))('%s never walks through the line', (_, path) => {
    for (let t = 0; t < periodOf(path); t += 0.1) {
      const { x, z } = poseAt(path, t);
      const onLine = x > LINE.from - 0.5 && x < LINE.to + 0.5 && Math.abs(z - LINE.z) < clear;
      expect(onLine, `t=${t.toFixed(1)} at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(false);
    }
  });
});

describe('bubbleAt', () => {
  it('lets a member of the crew say a workshop line, then stays quiet', () => {
    const bubble = bubbleAt(0.5);
    expect(Object.keys(ROUTES)).toContain(bubble.who);
    expect(LINES).toContain(bubble.text);
    expect(bubbleAt(5)).toBeNull();
  });

  it('turns speakers and lines over time', () => {
    const [a, b] = [bubbleAt(0.5), bubbleAt(7.5)];
    expect(a.who).not.toBe(b.who);
    expect(a.text).not.toBe(b.text);
  });
});
