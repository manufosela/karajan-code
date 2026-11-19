// KJC-TSK-1703 (the maintainer, 2026-11-19): "when the agents go to the board they walk over the
// row of tools". The row opens a passage in front of the task wall, between the Ledger and the
// Steward, and every way to the wall goes through it, so no robot walks through a piece.
import { describe, expect, it } from 'vitest';

import { COURIER_TRIP_MS, courierAt } from '../public/stage/courier.js';
import { PASSAGE, PLINTH_WIDTH, POST, POSTS, WALL, boothAt, postX } from '../public/stage/layout.js';
import { ERRAND_MS, withActivity, withErrand, workerAt } from '../public/stage/workers.js';

// A post's plinth and the figure on it, with room for a robot's body around it.
const ROBOT = 0.25;
const onAPiece = ({ x, z }) => POSTS.some((id) => Math.abs(x - postX(id)) < PLINTH_WIDTH / 2 + ROBOT && Math.abs(z - POST.z) < 0.31 + ROBOT);
const lanesAt = [-9, -4, 0, 3, 7];
const xOf = (lane) => lanesAt[Number(lane)];
const samples = (ms) => Array.from({ length: 200 }, (_, i) => (i * ms) / 200);

describe('the passage to the task wall', () => {
  it('opens in the row of posts, in front of the wall', () => {
    const between = POSTS.map(postX).toSorted((a, b) => a - b);
    const gap = between.find((x, i) => i > 0 && x - between[i - 1] >= PLINTH_WIDTH + 2 * ROBOT + 0.2);
    expect(gap).toBeDefined();
    expect(WALL.x).toBe(PASSAGE.x);
    expect(onAPiece({ x: PASSAGE.x, z: POST.z })).toBe(false);
  });

  it('a host on its errand walks through no piece, whichever its workshop', () => {
    for (const lane of lanesAt.keys()) {
      const host = withActivity([], { type: 'agent-activity', agent: 'claude', role: 'host', phase: 'start', lane: String(lane), id: 's1' }, -1e6);
      const [busy] = withErrand(host, { id: 'HU-1', lane: String(lane), out: true }, 0).workers;
      for (const t of samples(ERRAND_MS)) expect(onAPiece(workerAt(busy, t, xOf))).toBe(false);
    }
  });

  it('the courier walks through no piece either, out and back', () => {
    for (const lane of lanesAt.keys()) {
      for (const out of [true, false]) {
        const trip = { id: 'HU-1', lane: String(lane), out, at: 0 };
        for (const t of samples(COURIER_TRIP_MS)) {
          const at = courierAt(trip, t, xOf, undefined, boothAt(5));
          if (at) expect(onAPiece(at)).toBe(false);
        }
      }
    }
  });
});
