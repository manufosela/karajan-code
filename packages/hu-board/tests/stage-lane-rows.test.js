// KJC-TSK-1488: a factory's workshops can stand in several rows, so whatever goes to a
// lane's workshop takes the workshop's z from zOf(lane), not from the first row.
import { describe, expect, it } from 'vitest';

import { WORKSHOP } from '../public/stage/layout.js';
import { RAGAN_WALK_MS, raganAt } from '../public/stage/ragan.js';
import { COURIER_WALK_MS, courierAt } from '../public/stage/courier.js';
import { DESCENT_MS, sentinelAt } from '../public/stage/sentinel-watch.js';
import { benchSpots } from '../public/stage/bench-notes-layout.js';
import { WALK_MS, spotOf, workerAt, workersFrom } from '../public/stage/workers.js';

const ROW = 9; // how far back the lane's row is from the first one
const xOf = () => 4;
const zOf = () => WORKSHOP.z + ROW;

describe('every piece goes to the row of its lane (KJC-TSK-1488)', () => {
  it('a worker stands at the bench of its lane\'s row', () => {
    const [w] = workersFrom([{ agent: 'agy', role: 'solomon', at: 'x' }], 0, 'far');
    expect(workerAt(w, WALK_MS, xOf, zOf).z).toBeCloseTo(spotOf('solomon', 4).z + ROW);
  });

  it('kaRAGan hands the answer over at that row', () => {
    const pose = raganAt({ lane: 'far', at: 0 }, RAGAN_WALK_MS + 10, xOf, zOf);
    expect(pose.z).toBeCloseTo(raganAt({ lane: 'far', at: 0 }, RAGAN_WALK_MS + 10, xOf).z + ROW);
  });

  it('a courier leaves from and returns to that row', () => {
    const trip = { id: 'HU-1', lane: 'far', at: 0, out: true, back: false };
    expect(courierAt(trip, 0, xOf, zOf).z).toBeCloseTo(courierAt(trip, 0, xOf).z + ROW);
    expect(courierAt(trip, 2 * COURIER_WALK_MS + 800, xOf, zOf).z).toBeGreaterThan(WORKSHOP.z);
  });

  it('the Sentinel goes down beside the agent of that row', () => {
    const watch = { lane: 'far', stop: { lane: 'far', at: 0 } };
    expect(sentinelAt(watch, DESCENT_MS + 10, xOf, zOf).z).toBeCloseTo(sentinelAt(watch, DESCENT_MS + 10, xOf).z + ROW);
  });

  it('a card in progress sits over the bench of that row', () => {
    const [spot] = benchSpots([{ id: 'HU-1', lane: 'far', status: 'running' }], xOf, new Set(), zOf);
    expect(spot.z).toBeCloseTo(benchSpots([{ id: 'HU-1', lane: 'far', status: 'running' }], xOf, new Set())[0].z + ROW);
  });
});
