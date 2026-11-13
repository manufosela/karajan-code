// KJC-TSK-1584: each time the Sentinel checks a host's tool call and lets it through, it blinks its
// own light on its post; a denial going on keeps its red.
import { describe, expect, it } from 'vitest';

import { BLINK_MS, blinkAt, withWatch } from '../public/stage/sentinel-watch.js';

const beat = { type: 'agent-activity', role: 'host', phase: 'start', lane: 'a' };

describe('the Sentinel lets a call through', () => {
  it('blinks for a moment on each host beat, then rests', () => {
    const watch = withWatch({}, beat, 1000);
    expect(blinkAt(watch, 999)).toBe(0);
    expect(blinkAt(watch, 1000 + BLINK_MS / 2)).toBeCloseTo(1);
    expect(blinkAt(watch, 1000 + BLINK_MS)).toBe(0);
  });

  it('does not blink without a beat, nor while it is down answering a denial', () => {
    expect(blinkAt({}, 10)).toBe(0);
    const denied = withWatch(withWatch({}, { type: 'sentinel-deny', lane: 'a', tool: 'Bash' }, 0), beat, 100);
    expect(blinkAt(denied, 100 + BLINK_MS / 2)).toBe(0);
  });

  it('an agent that is not the host does not make it blink', () => {
    expect(blinkAt(withWatch({}, { ...beat, role: 'coder' }, 0), BLINK_MS / 2)).toBe(0);
  });
});
