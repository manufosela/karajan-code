// KJC-TSK-1589 (asked by the maintainer on 2026-11-13): desks with legs, where the agents open their
// laptops, instead of the rectangular bench.
import { describe, expect, it } from 'vitest';

// KJC-TSK-1591 (the maintainer, 2026-11-13): the long desk and its chairs faced the camera while the
// agent types side on (KJC-TSK-1486); each agent now has a standing desk of its own, turned with it.
import { DESK, deskParts } from '../public/stage/desk-layout.js';
import { SEATS, TYPING_YAW, spotOf } from '../public/stage/workers.js';

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
