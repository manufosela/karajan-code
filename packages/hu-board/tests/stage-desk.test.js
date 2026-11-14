// KJC-TSK-1589 (asked by the maintainer on 2026-11-13): desks with legs, where the agents open their
// laptops, instead of the rectangular bench.
import { describe, expect, it } from 'vitest';

// KJC-TSK-1591 (the maintainer, 2026-11-13): the long desk and its chairs faced the camera while the
// agent types side on (KJC-TSK-1486); each agent now has a standing desk of its own, turned with it.
import { DESK, deskParts } from '../public/stage/desk-layout.js';
import { SEATS, TYPING_YAW, spotOf } from '../public/stage/workers.js';
import { HOST_SCALE } from '../public/stage/host-look.js';
import { SCALE } from '../public/stage/layout.js';

/** Where `point` falls in a desk's own frame: along the way its agent faces, and across it. */
const inDesk = (desk, point) => {
  const dx = point.x - desk.x;
  const dz = point.z - desk.z;
  return { along: dx * Math.sin(desk.yaw) + dz * Math.cos(desk.yaw), across: dx * Math.cos(desk.yaw) - dz * Math.sin(desk.yaw) };
};
const onDesk = (desk, point) => {
  const { along, across } = inDesk(desk, point);
  return Math.abs(along) < desk.depth / 2 && Math.abs(across) < desk.width / 2;
};

describe('deskParts', () => {
  const desks = deskParts();
  // In the workshop's own frame, as the desks are drawn.
  const spots = SEATS.map((_, seat) => spotOf('host', 0, seat, 0));

  it('one desk for each seat, turned as the agent that types there, and no chair', () => {
    expect(desks).toHaveLength(SEATS.length);
    for (const desk of desks) expect(desk.yaw).toBe(TYPING_YAW);
    for (const desk of desks) expect(desk).not.toHaveProperty('chairs');
  });

  it('each desk stands in front of its agent, under its laptop, never over the agent', () => {
    desks.forEach((desk, seat) => {
      const ahead = inDesk(desk, spots[seat]);
      expect(ahead.along).toBeLessThan(0); // its agent stands behind it, facing it
      expect(Math.abs(ahead.across)).toBeLessThan(1e-9);
      expect(onDesk(desk, spots[seat])).toBe(false);
      expect(desk.height).toBeLessThan(DESK.laptop);
    });
  });

  // KJC-TSK-1612 (the maintainer, 2026-11-14): "the ones with a backpack take a lot of room; they
  // overlap". Along the row, a desk's far edge and the next agent's backpack leave room between them.
  it('leaves room between one agent\'s desk and the backpack of the next, the bigger host included', () => {
    const PACK_REACH = 1.3; // the backpack's back, behind its robot, before scaling (backpack.js)
    const hostScale = SCALE.crew * HOST_SCALE;
    const along = Math.sin(TYPING_YAW); // how much of a reach along the agent's way runs along the row
    for (let seat = 0; seat + 1 < SEATS.length; seat++) {
      const deskEdge = spots[seat].x + (DESK.ahead + DESK.depth / 2) * along;
      const packBack = spots[seat + 1].x - PACK_REACH * hostScale * along;
      expect(packBack - deskEdge).toBeGreaterThan(0.2);
    }
  });

  // KJC-BUG-0589 (the maintainer, 2026-11-14): "some agents behind, to the left, piled up, as if
  // they did not fit and changed row without leaving room". A robot is 2.52 wide ear to ear and
  // reaches 1 ahead and 1.3 behind with its backpack (cast/robot-head.js, backpack.js); a subagent
  // is drawn at 0.55 (agents-floor.js).
  const HALF_WIDTH = 1.26;
  const AHEAD = 1;
  const BEHIND = 1.3;
  const DWARF = 0.55;
  const GAP = 0.15;

  it('a seat past the bench\'s four stands a robot\'s width behind the one in front of it, the bigger host included', () => {
    for (let seat = 0; seat < SEATS.length; seat++) {
      const front = spotOf('host', 0, seat, 0);
      const behind = spotOf('coder', 0, seat + SEATS.length, 0);
      // Half a seat over, in the gap between two robots in front, where it is seen.
      expect(behind.x - front.x).toBeCloseTo((SEATS[1] - SEATS[0]) / 2);
      // Typing side on, a robot's width runs across the row, towards the camera.
      expect(front.z - behind.z).toBeGreaterThan(HALF_WIDTH * SCALE.crew * (HOST_SCALE + 1) + GAP);
    }
  });

  it('the host\'s subagents keep clear of the bench, and each row of them of the next', () => {
    const sub = SCALE.crew * DWARF;
    const first = spotOf('subagent', 0, 0, 0);
    const next = spotOf('subagent', 0, 5, 0);
    expect(next.x).toBeCloseTo(first.x);
    expect(next.z - first.z).toBeGreaterThan((AHEAD + BEHIND) * sub + GAP);
    expect(first.z - BEHIND * sub - HALF_WIDTH * SCALE.crew * HOST_SCALE).toBeGreaterThan(GAP);
  });

  it('no desk stands where a neighbour agent stands', () => {
    desks.forEach((desk, seat) => {
      for (const [other, spot] of spots.entries()) if (other !== seat) expect(onDesk(desk, spot)).toBe(false);
    });
  });

  it('a leg at each corner of its top, inside it', () => {
    for (const desk of desks) {
      expect(desk.legs).toHaveLength(4);
      for (const leg of desk.legs) {
        expect(Math.abs(leg.across)).toBeLessThan(desk.width / 2);
        expect(Math.abs(leg.along)).toBeLessThan(desk.depth / 2);
      }
    }
  });
});
