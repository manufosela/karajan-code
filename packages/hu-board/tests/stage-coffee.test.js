// KJC-TSK-1663 (the maintainer, 2026-11-17): "a coffee cart robot could come and serve the waiting
// agents a cup; when they have to work again it comes back, takes the cup and they get back to it."
import { describe, expect, it } from 'vitest';

import { CART_TRIP_MS, HAND_AT_MS, cartAt, hasCup, withCoffee } from '../public/stage/coffee.js';
import { boothAt } from '../public/stage/layout.js';
import { BUD_MS } from '../public/stage/workers.js';

const host = (key, waiting, spot = { x: 4, z: 2 }) => ({ key, waiting, spot });
const door = boothAt(1);

describe('withCoffee', () => {
  it('sends the cart to a host that starts waiting, once, and back for the cup only once it served it', () => {
    const trips = withCoffee([], [host('a', 'person'), host('b', null)], 1000);
    expect(trips).toEqual([{ host: 'a', serve: true, at: 1000, spot: { x: 4, z: 2 } }]);
    expect(withCoffee(trips, [host('a', 'person')], 2000)).toHaveLength(1);
    expect(withCoffee(trips, [host('a', null)], 2000)).toHaveLength(1);
    expect(withCoffee(trips, [host('a', null)], 1000 + HAND_AT_MS)).toHaveLength(2);
  });

  it('sends it back to take the cup once that host works again', () => {
    let trips = withCoffee([], [host('a', 'process')], 0);
    trips = withCoffee(trips, [host('a', null)], 60_000);
    expect(trips.at(-1)).toMatchObject({ host: 'a', serve: false, at: 60_000 });
    // No second trip to take it: the serving one, done long ago, is forgotten meanwhile.
    expect(withCoffee(trips, [host('a', null)], 70_000)).toEqual([trips.at(-1)]);
  });

  it('forgets the trips done long ago, keeping whether each host holds its cup', () => {
    const trips = withCoffee(withCoffee([], [host('a', 'person')], 0), [host('a', 'person')], CART_TRIP_MS + 1);
    expect(hasCup(trips, 'a', CART_TRIP_MS + 1)).toBe(true);
  });
});

describe('cartAt and hasCup', () => {
  const serve = { host: 'a', serve: true, at: 0, spot: { x: 4, z: 2 } };

  it('teleports in at the booth, walks beside the host, hands over, walks back and teleports out', () => {
    expect(cartAt(serve, 0, door)).toMatchObject({ x: door.x, z: door.z, size: 0, walking: false });
    expect(cartAt(serve, BUD_MS + 10, door)).toMatchObject({ walking: true, size: 1 });
    const there = cartAt(serve, HAND_AT_MS, door);
    expect(Math.hypot(there.x - 4, there.z - 2)).toBeLessThan(1.5);
    expect(there.walking).toBe(false);
    expect(cartAt(serve, CART_TRIP_MS - BUD_MS / 2, door)).toMatchObject({ x: door.x, z: door.z, walking: false });
    expect(cartAt(serve, CART_TRIP_MS, door)).toBeNull();
  });

  it('a host holds its cup from the moment the cart hands it over until the cart takes it back', () => {
    const take = { host: 'a', serve: false, at: 50_000, spot: { x: 4, z: 2 } };
    const trips = [serve, take];
    expect(hasCup(trips, 'a', HAND_AT_MS - 1)).toBe(false);
    expect(hasCup(trips, 'a', HAND_AT_MS)).toBe(true);
    expect(hasCup(trips, 'a', 50_000 + HAND_AT_MS - 1)).toBe(true);
    expect(hasCup(trips, 'a', 50_000 + HAND_AT_MS)).toBe(false);
    expect(hasCup(trips, 'nobody', 1e9)).toBe(false);
  });

  it('the cart carries the cup on its way to serve it and on its way back from taking it', () => {
    const take = { host: 'a', serve: false, at: 0, spot: { x: 4, z: 2 } };
    expect(cartAt(serve, BUD_MS + 10, door).cup).toBe(true);
    expect(cartAt(serve, HAND_AT_MS + 10, door).cup).toBe(false);
    expect(cartAt(take, BUD_MS + 10, door).cup).toBe(false);
    expect(cartAt(take, HAND_AT_MS + 10, door).cup).toBe(true);
  });
});
