// KJC-TSK-1436 (ADR 0048): the Sentinel watches from its raised post, turns to the
// lane whose actions it checks and goes down to stop the agent when it denies one.
import { describe, expect, it } from 'vitest';

import { SENTINEL_POST, WORKSHOP } from '../public/stage/layout.js';
import { DESCENT_MS, STAY_MS, sentinelAt, withWatch } from '../public/stage/sentinel-watch.js';

const xOf = (lane) => ({ main: -6, 'kj-stage': 6 })[lane] ?? 0;
const beat = (lane) => ({ type: 'agent-activity', role: 'host', phase: 'start', lane });
const deny = (lane) => ({ type: 'sentinel-deny', lane, tool: 'Bash' });

describe('the Sentinel at work', () => {
  it('stays on its post, and turns to the lane whose host it is checking', () => {
    const still = sentinelAt({}, 0, xOf);
    expect(still).toMatchObject({ x: SENTINEL_POST.x, y: SENTINEL_POST.height, z: SENTINEL_POST.z, down: false });
    const right = sentinelAt(withWatch({}, beat('kj-stage'), 0), 0, xOf);
    const left = sentinelAt(withWatch({}, beat('main'), 0), 0, xOf);
    expect(right.yaw).toBeGreaterThan(0);
    expect(left.yaw).toBeLessThan(0);
    expect(right.y).toBe(SENTINEL_POST.height);
  });

  it('on a denial goes down to that lane, stays with the agent, and climbs back to its post', () => {
    const watch = withWatch({}, deny('kj-stage'), 1000);
    expect(sentinelAt(watch, 1000, xOf)).toMatchObject({ y: SENTINEL_POST.height });
    const there = sentinelAt(watch, 1000 + DESCENT_MS + STAY_MS / 2, xOf);
    expect(there).toMatchObject({ y: 0, down: true });
    // within the workshop of the lane it stopped (the pad is WORKSHOP.width wide, plus a step)
    expect(Math.abs(there.x - xOf('kj-stage'))).toBeLessThan(WORKSHOP.width / 2 + 0.2);
    const back = sentinelAt(watch, 1000 + 2 * DESCENT_MS + STAY_MS, xOf);
    expect(back).toMatchObject({ x: SENTINEL_POST.x, y: SENTINEL_POST.height, down: false });
  });

  it('other events change nothing; the latest denial is the one it answers', () => {
    const watch = withWatch({}, deny('main'), 0);
    expect(withWatch(watch, { type: 'review-verdict' }, 10)).toBe(watch);
    expect(withWatch(watch, deny('kj-stage'), 20).stop).toEqual({ lane: 'kj-stage', at: 20 });
  });
});
