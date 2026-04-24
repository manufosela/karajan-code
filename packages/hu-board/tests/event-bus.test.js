import { describe, it, expect, beforeEach } from 'vitest';
import { subscribe, publish, subscriberCount, _resetForTests } from '../src/event-bus.js';

describe('event-bus', () => {
  beforeEach(() => { _resetForTests(); });

  it('fan-outs each publish to every subscriber', () => {
    const seenA = [];
    const seenB = [];
    subscribe((e) => seenA.push(e));
    subscribe((e) => seenB.push(e));

    publish({ type: 'plan', planId: 'p1' });
    publish({ type: 'session', sessionId: 's1' });

    expect(seenA).toHaveLength(2);
    expect(seenB).toHaveLength(2);
    expect(seenA[0]).toEqual({ type: 'plan', planId: 'p1' });
  });

  it('unsubscribe stops delivery without affecting the other subscribers', () => {
    const a = [];
    const b = [];
    const unsubA = subscribe((e) => a.push(e));
    subscribe((e) => b.push(e));

    publish({ type: 'plan' });
    unsubA();
    publish({ type: 'session' });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it('a subscriber throwing does not take the bus down', () => {
    const seen = [];
    subscribe(() => { throw new Error('boom'); });
    subscribe((e) => seen.push(e));

    publish({ type: 'plan' });

    expect(seen).toHaveLength(1);
  });

  it('subscriberCount reflects live listeners', () => {
    expect(subscriberCount()).toBe(0);
    const unsub = subscribe(() => {});
    expect(subscriberCount()).toBe(1);
    unsub();
    expect(subscriberCount()).toBe(0);
  });
});
