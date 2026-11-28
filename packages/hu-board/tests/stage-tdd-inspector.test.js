// KJC-TSK-1816 (decided by the maintainer on 2026-11-27): TDD is Karajan as an inspector with a
// traffic light at the coder's desk. The light follows kj review's TDD check (tests with the code):
// red, and a raised hand that stops the coder, when it refuses; green when it passes.
import { describe, expect, it } from 'vitest';

import { HELD_PROPS, costumeOfPiece } from '../public/stage/piece-costumes.js';
import { trafficLight } from '../public/stage/traffic-light.js';
import { PIECE_WALK_MS, VISIT_SPOTS, WALKS_TO_WORK, pieceAt, withVisit } from '../public/stage/piece-visit.js';
import { deskParts } from '../public/stage/desk-layout.js';
import { PLINTH_WIDTH } from '../public/stage/layout.js';
import { spotOf } from '../public/stage/workers.js';
import { CARDS } from '../public/stage/legend.js';
import { cardsIn } from '../public/stage/legend-es.js';

describe('the TDD inspector', () => {
  it('is Karajan as an inspector, the traffic light in his left hand and the right one free to stop', () => {
    expect(costumeOfPiece('tdd')).toEqual({ name: 'inspector', parts: ['hivis', 'trafficlight'] });
    expect(HELD_PROPS.trafficlight).toBe('left');
  });

  it('turns the light red and raises the hand when the check refuses, green when it passes', () => {
    expect(trafficLight(0, 1)).toEqual({ red: 1, green: 0, stop: 1 });
    expect(trafficLight(1, 0)).toEqual({ red: 0, green: 1, stop: 0 });
    expect(trafficLight(0, 0)).toEqual({ red: 0, green: 0, stop: 0 });
    // A refusal wins over the earned light: the hand stays up while the red lasts.
    expect(trafficLight(0.4, 0.7)).toEqual({ red: 0.7, green: 0, stop: 0.7 });
  });

  it('stands at the coder\'s desk, on the side away from AI review, clear of the robot and the desk', () => {
    // One frame for all three: VISIT_SPOTS are offsets from the workshop's centre, spotOf(..., 0, ..., 0)
    // measures from a workshop centred at x 0, z 0, and deskParts() places the desks with that same call.
    const coder = spotOf('coder', 0, undefined, 0);
    const piece = { x: VISIT_SPOTS.tdd.dx, z: VISIT_SPOTS.tdd.dz };
    expect(Math.abs(deskParts()[1].x - coder.x)).toBeLessThan(1); // the coder's own desk, in this frame
    const half = PLINTH_WIDTH / 2;
    expect(Math.hypot(piece.x - coder.x, piece.z - coder.z)).toBeLessThan(1.4);
    expect(Math.sign(piece.x - coder.x)).not.toBe(Math.sign(VISIT_SPOTS.review.dx - coder.x) || 1);
    expect(piece.z).toBeGreaterThan(coder.z);
    const desk = deskParts()[1];
    const corners = [-1, 1].flatMap((a) => [-1, 1].map((c) => ({
      x: desk.x + a * (desk.depth / 2) * Math.sin(desk.yaw) + c * (desk.width / 2) * Math.cos(desk.yaw),
      z: desk.z + a * (desk.depth / 2) * Math.cos(desk.yaw) - c * (desk.width / 2) * Math.sin(desk.yaw),
    })));
    for (const corner of corners) expect(Math.abs(corner.x - piece.x) < half && Math.abs(corner.z - piece.z) < half).toBe(false);
  });

  // #5020 (codex): the spot moved only the drone; the inspector stayed at its post. He walks there himself.
  it('walks to the coder\'s desk himself, with no drone, and back to his post', () => {
    expect(WALKS_TO_WORK.has('tdd')).toBe(true);
    const home = { x: -4, z: -3 };
    const visits = withVisit({}, { type: 'method-check', piece: 'tdd', outcome: 'refuse', lane: 'a' }, 0);
    const there = pieceAt(visits.tdd, PIECE_WALK_MS + 10, home, () => 10, () => 2);
    expect(there).toMatchObject({ x: 10 + VISIT_SPOTS.tdd.dx, z: 2 + VISIT_SPOTS.tdd.dz, away: true });
    expect(pieceAt(visits.tdd, visits.tdd.until + 2 * PIECE_WALK_MS, home, () => 10, () => 2)).toMatchObject({ ...home, away: false });
  });

  it('tells the inspector in the legend, in English and Spanish', () => {
    const en = CARDS.find((c) => c.id === 'tdd').marks.map((m) => `${m.mark} ${m.means}`).join(' ').toLowerCase();
    const es = cardsIn('es').find((c) => c.id === 'tdd').marks.map((m) => `${m.mark} ${m.means}`).join(' ').toLowerCase();
    for (const w of ['inspector', 'traffic light', 'stop']) expect(en).toContain(w);
    for (const w of ['inspector', 'semáforo', 'para']) expect(es).toContain(w);
  });
});
