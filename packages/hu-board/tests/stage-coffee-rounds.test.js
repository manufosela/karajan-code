// KJC-TSK-1813 (the maintainer, 2026-11-27): "too many waiters serving coffee, a coffee for one second
// and they come back to take it; let a sensible time pass, and when it gets to work it should leave
// the cup on the desk, because it comes to take it and you do not see it take anything".
import { describe, expect, it } from 'vitest';

import { CART_TRIP_MS, HAND_AT_MS, SERVE_AFTER_MS, cupOnDesk, deskCupSpot, hostsAtDesks, inHand, waitsSince, withCoffee } from '../public/stage/coffee.js';
import { DESK } from '../public/stage/desk-layout.js';
import { WORKSHOP } from '../public/stage/layout.js';
import { BUD_MS, TYPING_YAW, spotOf, visitKey, workersFrom } from '../public/stage/workers.js';

const spot = { x: 4, z: 2 };
const host = (key, waiting, since) => ({ key, waiting, since, spot });

describe('only a wait that lasts gets a coffee', () => {
  it('no cart for a host that has waited under two minutes, one once it has', () => {
    expect(withCoffee([], [host('a', 'person', 0)], SERVE_AFTER_MS - 1)).toEqual([]);
    expect(withCoffee([], [host('a', 'person', 0)], SERVE_AFTER_MS)).toEqual([{ host: 'a', serve: true, at: SERVE_AFTER_MS, spot }]);
  });

  it('remembers when each host began to wait, and forgets it once it works', () => {
    const first = waitsSince({}, [host('a', 'person'), host('b', null), host('c', 'rest')], 100);
    expect(first).toEqual({ a: 100 });
    expect(waitsSince(first, [host('a', 'person'), host('b', 'process')], 500)).toEqual({ a: 100, b: 500 });
    expect(waitsSince(first, [host('a', null)], 500)).toEqual({});
  });
});

describe('one cart on its rounds', () => {
  it('serves one host at a time, the longest wait first', () => {
    const now = 10 * SERVE_AFTER_MS;
    const hosts = [host('late', 'person', 5000), host('early', 'process', 1000)];
    const trips = withCoffee([], hosts, now);
    expect(trips.map((t) => t.host)).toEqual(['early']);
    expect(withCoffee(trips, hosts, now + CART_TRIP_MS - 1)).toBe(trips);
    expect(withCoffee(trips, hosts, now + CART_TRIP_MS).at(-1)).toMatchObject({ host: 'late', serve: true });
  });

  it('takes back a cup left on a desk before it serves another', () => {
    let trips = withCoffee([], [host('a', 'person', 0)], SERVE_AFTER_MS);
    const later = SERVE_AFTER_MS + CART_TRIP_MS;
    trips = withCoffee(trips, [host('a', null), host('b', 'person', 0)], later);
    expect(trips.at(-1)).toMatchObject({ host: 'a', serve: false, at: later });
  });
});

describe('only hosts the stage draws at their desks', () => {
  it('leaves out one still walking in, one that left and anyone who is not a host', () => {
    const [seated] = workersFrom([{ agent: 'claude', role: 'host', id: 's1', at: 'x', waiting: 'person' }], 0, 'main');
    const walking = { ...seated, id: 's2', since: 100_000 };
    const gone = { ...seated, id: 's3', leftAt: 1000 };
    const coder = { ...seated, id: 's4', role: 'coder' };
    const at = hostsAtDesks([seated, walking, gone, coder], 100_000 + BUD_MS, {});
    expect(at).toEqual([{ key: visitKey(seated), waiting: 'person', spot: spotOf('host', 0, seated.slot, WORKSHOP.z) }]);
  });
});

describe('the cup on the desk', () => {
  const serve = { host: 'a', serve: true, at: 0, spot };

  it('is in the hand while the host waits, on its desk once it works, until the cart takes it', () => {
    expect(inHand('person')).toBe(true);
    expect(inHand(null)).toBe(false);
    expect(inHand('rest')).toBe(false);
    const take = { host: 'a', serve: false, at: 50_000, spot };
    expect(cupOnDesk([serve], [host('a', 'person')], HAND_AT_MS)).toEqual([]);
    expect(cupOnDesk([serve], [host('a', null)], HAND_AT_MS)).toEqual([{ host: 'a', ...deskCupSpot(spot) }]);
    expect(cupOnDesk([serve, take], [host('a', null)], 50_000 + HAND_AT_MS - 1)).toHaveLength(1);
    expect(cupOnDesk([serve, take], [host('a', null)], 50_000 + HAND_AT_MS)).toEqual([]);
  });

  it('stays on the desk while the cart walks to take it, though the trip that served it is forgotten', () => {
    let trips = withCoffee([], [host('a', 'person', 0)], SERVE_AFTER_MS);
    const later = SERVE_AFTER_MS + CART_TRIP_MS;
    trips = withCoffee(withCoffee(trips, [host('a', null)], later), [host('a', null)], later + 1);
    expect(trips.map((t) => t.serve)).toEqual([false]);
    expect(cupOnDesk(trips, [host('a', null)], later + 1)).toHaveLength(1);
    expect(cupOnDesk(trips, [host('a', null)], later + HAND_AT_MS)).toEqual([]);
  });

  it('stands on the desk top, ahead of the host where its desk is', () => {
    const cup = deskCupSpot(spot);
    expect(cup.y).toBeCloseTo(DESK.laptop);
    const ahead = (cup.x - spot.x) * Math.sin(TYPING_YAW) + (cup.z - spot.z) * Math.cos(TYPING_YAW);
    expect(ahead).toBeCloseTo(DESK.ahead);
  });
});
