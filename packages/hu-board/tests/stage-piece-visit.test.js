// KJC-TSK-1517 (decided by the maintainer on 2026-11-11): AI review, Git gates and the
// Ledger leave their post for the workshop of the lane they act on, and come back.
import { describe, expect, it } from 'vitest';

import { PIECE_WALK_MS, REVIEW_MAX_MS, VISIT_MS, VISIT_SPOTS, pieceAt, withVisit } from '../public/stage/piece-visit.js';
import { deskParts } from '../public/stage/desk-layout.js';
import { PLINTH_WIDTH } from '../public/stage/layout.js';
import { spotOf } from '../public/stage/workers.js';

const xOf = (lane) => ({ a: 10, b: -10 })[lane];
const zOf = () => 2;
const home = { x: 1, z: -3 };
const verdict = (lane) => ({ type: 'review-verdict', verdict: 'approved', lane });
const spotIn = (piece, lane) => ({ x: xOf(lane) + VISIT_SPOTS[piece].dx, z: zOf(lane) + VISIT_SPOTS[piece].dz });
const at = (visits, piece, now) => pieceAt(visits[piece], now, home, xOf, zOf);

describe('withVisit', () => {
  it('sends the piece that handles a verdict, a commit or a seal to its lane', () => {
    let visits = withVisit({}, verdict('a'), 0);
    visits = withVisit(visits, { type: 'commit-gate', outcome: 'fail', lane: 'b' }, 0);
    visits = withVisit(visits, { type: 'ledger-seal', decision: 'allow' }, 0);
    expect(Object.fromEntries(Object.entries(visits).map(([id, v]) => [id, v.lane]))).toEqual({ review: 'a', gates: 'b', ledger: 'main' });
    expect(withVisit(visits, { type: 'sentinel-deny', lane: 'a' }, 5)).toBe(visits);
  });

  it('keeps a piece already in the workshop of that lane there for longer', () => {
    let visits = withVisit({}, verdict('a'), 0);
    visits = withVisit(visits, verdict('a'), PIECE_WALK_MS + 1000);
    expect(visits.review.at).toBe(0);
    expect(at(visits, 'review', PIECE_WALK_MS + 1000 + VISIT_MS - 10)).toMatchObject({ ...spotIn('review', 'a'), walking: false });
  });
});

describe('pieceAt', () => {
  it('rests at its post when nothing calls it', () => {
    expect(pieceAt(undefined, 0, home, xOf, zOf)).toMatchObject({ ...home, walking: false, away: false });
  });

  it('walks to its spot in the workshop, stays, walks back and rests at its post', () => {
    const visits = withVisit({}, verdict('a'), 1000);
    const half = at(visits, 'review', 1000 + PIECE_WALK_MS / 2);
    expect(half.x).toBeCloseTo((home.x + spotIn('review', 'a').x) / 2);
    expect(half).toMatchObject({ walking: true, away: true });
    expect(at(visits, 'review', 1000 + PIECE_WALK_MS + VISIT_MS / 2)).toMatchObject({ ...spotIn('review', 'a'), walking: false });
    expect(at(visits, 'review', 1000 + 2 * PIECE_WALK_MS + VISIT_MS - 10).walking).toBe(true);
    expect(at(visits, 'review', 1000 + 2 * PIECE_WALK_MS + VISIT_MS)).toMatchObject({ ...home, away: false });
  });

  it('called to another lane on its way, it turns there from where it is, without a jump', () => {
    let visits = withVisit({}, verdict('a'), 0);
    const turn = PIECE_WALK_MS / 2;
    const before = at(visits, 'review', turn);
    visits = withVisit(visits, verdict('b'), turn);
    expect(at(visits, 'review', turn)).toMatchObject({ x: before.x, z: before.z });
    expect(at(visits, 'review', turn + PIECE_WALK_MS)).toMatchObject(spotIn('review', 'b'));
  });

  it('called away on its walk back, it sets off from that point of its way home', () => {
    let visits = withVisit({}, verdict('a'), 0);
    const turn = PIECE_WALK_MS * 1.5 + VISIT_MS;
    const before = at(visits, 'review', turn);
    expect(before).toMatchObject({ walking: true, away: true });
    visits = withVisit(visits, verdict('b'), turn);
    expect(at(visits, 'review', turn)).toMatchObject({ x: before.x, z: before.z });
  });

  // KJC-TSK-1524: kj review's checks of TDD, Sonar and the Steward send them too.
  it('sends TDD, Sonar or the Steward when kj review checks them', () => {
    const visits = withVisit({}, { type: 'method-check', piece: 'sonar', outcome: 'refuse', lane: 'a' }, 0);
    expect(visits.sonar.lane).toBe('a');
    expect(at(visits, 'sonar', PIECE_WALK_MS + 10)).toMatchObject({ ...spotIn('sonar', 'a'), walking: false });
    expect(withVisit({}, { type: 'method-check', piece: 'oracle', lane: 'a' }, 0)).toEqual({});
  });

  // KJC-TSK-1528 (decided by the maintainer on 2026-11-11): the AI review piece does the reviewing.
  describe('while an agent reviews', () => {
    const review = (phase, lane = 'a') => ({ type: 'agent-activity', agent: 'codex', role: 'reviewer', phase, lane });

    it('the AI review piece goes to its lane with the agent name and stays as long as the review lasts', () => {
      const visits = withVisit({}, review('start'), 0);
      expect(visits.review).toMatchObject({ lane: 'a', by: 'codex' });
      expect(at(visits, 'review', PIECE_WALK_MS + 10 * 60_000)).toMatchObject({ ...spotIn('review', 'a'), walking: false });
      expect(withVisit({}, { ...review('start'), role: 'coder' }, 0)).toEqual({});
    });

    it('the end of the review sends it back, and the verdict right after keeps it a while', () => {
      let visits = withVisit({}, review('start'), 0);
      visits = withVisit(visits, review('end'), 60_000);
      expect(at(visits, 'review', 60_000 + PIECE_WALK_MS / 2).walking).toBe(true);
      visits = withVisit(withVisit({}, review('start'), 0), review('end'), 60_000);
      visits = withVisit(visits, verdict('a'), 60_000);
      expect(at(visits, 'review', 60_000 + VISIT_MS - 10)).toMatchObject({ ...spotIn('review', 'a'), walking: false });
    });

    it('goes back on its own when no end comes', () => {
      const visits = withVisit({}, review('start'), 0);
      expect(at(visits, 'review', REVIEW_MAX_MS + 2 * PIECE_WALK_MS)).toMatchObject({ ...home, away: false });
    });
  });

  // KJC-TSK-1594 (the maintainer, 2026-11-13): reviewing, AI review stands beside the agent it reviews.
  // On the camera's side: on the far one the robots hid it.
  it('AI review stands at the coder\'s side, towards the camera, clear of it and its desk', () => {
    const coder = spotOf('coder', 0, undefined, 0);
    const piece = { x: VISIT_SPOTS.review.dx, z: VISIT_SPOTS.review.dz };
    const half = PLINTH_WIDTH / 2;
    expect(Math.abs(piece.x - coder.x)).toBeLessThan(0.3); // at its side, not ahead or behind it
    expect(piece.z).toBeGreaterThan(coder.z + half); // clear of the robot
    expect(piece.z - coder.z).toBeLessThan(1.2); // close enough to look at its screen
    const desk = deskParts()[1];
    const corners = [-1, 1].flatMap((a) => [-1, 1].map((c) => ({
      x: desk.x + a * (desk.depth / 2) * Math.sin(desk.yaw) + c * (desk.width / 2) * Math.cos(desk.yaw),
      z: desk.z + a * (desk.depth / 2) * Math.cos(desk.yaw) - c * (desk.width / 2) * Math.sin(desk.yaw),
    })));
    for (const corner of corners) expect(Math.abs(corner.x - piece.x) < half && Math.abs(corner.z - piece.z) < half).toBe(false);
  });

  it('puts each piece on a spot of its own, clear of the host, kaRAGan and the Sentinel', () => {
    const others = [{ dx: -1.3, dz: -0.4 }, { dx: -1.3, dz: -1.2 }, { dx: -2.1, dz: -0.4 }];
    const spots = Object.values(VISIT_SPOTS);
    for (const [i, a] of spots.entries()) {
      for (const b of [...others, ...spots.slice(i + 1)]) expect(Math.hypot(a.dx - b.dx, a.dz - b.dz)).toBeGreaterThan(0.8);
    }
  });
});
