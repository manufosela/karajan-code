// KJC-BUG-0577: a teammate's agent comes with its owner and avatar (room/bridge.js), but the scene
// dropped both, so its robots wore the own avatar. Its worker and its state keep them.
import { describe, expect, it } from 'vitest';

import { avatarFor } from '../public/stage/avatars.js';
import { withEvent } from '../public/stage/rest.js';
import { withActivity, workersFrom } from '../public/stage/workers.js';

const jorge = { emblem: 'fox', colors: { host: '#ff8800' } };
const own = { emblem: 'owl', colors: {} };
const start = { type: 'agent-activity', agent: 'codex', role: 'host', phase: 'start', id: 's1', lane: 'feat@jorge', owner: 'jorge', avatar: jorge, at: 'x' };

describe('a teammate\'s robot', () => {
  it('a live start keeps its owner and wears its owner\'s avatar, not the own one', () => {
    const [w] = withActivity([], start, 0);
    expect(w.owner).toBe('jorge');
    expect(avatarFor(w, own)).toEqual(jorge);
  });

  it('one already at work when the stage opens keeps them too', () => {
    const [w] = workersFrom([start], 5000, 'feat@jorge');
    expect(w.owner).toBe('jorge');
    expect(avatarFor(w, own)).toEqual(jorge);
  });

  it('the state of its lane keeps them, so a resync draws it the same', () => {
    const { working } = withEvent({}, start);
    expect(working[0]).toMatchObject({ owner: 'jorge', avatar: jorge });
  });

  it('a teammate with no avatar looks plain, never like the own one', () => {
    const [w] = withActivity([], { ...start, avatar: undefined }, 0);
    expect(avatarFor(w, own)).toEqual({ emblem: null, colors: {} });
  });

  it('an own agent has neither, and wears the own avatar', () => {
    const [w] = withActivity([], { ...start, owner: undefined, avatar: undefined, lane: 'main' }, 0);
    expect(w).not.toHaveProperty('owner');
    expect(avatarFor(w, own)).toEqual(own);
  });
});
