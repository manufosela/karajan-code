// KJC-TSK-1653 (the maintainer, 2026-11-16): when a session stops to wait ("Me paro por esperar a que
// el job de npm pida tu aprobación"), shouldn't something be seen? A host waiting for you raises its
// hand toward the camera under an amber "!" that beats; one waiting for a process, a blue hourglass turns.
import { describe, expect, it } from 'vitest';

import { WAIT_BEAT_MS, waitLook } from '../public/stage/wait-look.js';

describe('waitLook', () => {
  it('waiting for you: faces the camera, its hand up, under an amber "!" that beats', () => {
    const look = waitLook('person', 0);
    expect(look).toMatchObject({ mark: 'alert', facesCamera: true });
    expect(look.hand).toBeGreaterThan(2);
    const beats = [0, WAIT_BEAT_MS / 4, WAIT_BEAT_MS / 2].map((t) => waitLook('person', t).pulse);
    expect(new Set(beats.map((p) => p.toFixed(2))).size).toBeGreaterThan(1);
    for (const p of beats) expect(p).toBeGreaterThanOrEqual(0.5);
  });

  it('waiting for a process: stays as it is, under a blue hourglass that turns', () => {
    const look = waitLook('process', 1000);
    expect(look).toMatchObject({ mark: 'hourglass', facesCamera: false, hand: 0 });
    expect(waitLook('process', 2000).spin).not.toBe(look.spin);
  });

  it('not waiting: no mark at all', () => {
    expect(waitLook(null, 0)).toBeNull();
    expect(waitLook(undefined, 0)).toBeNull();
    expect(waitLook('nothing', 0)).toBeNull();
  });
});
