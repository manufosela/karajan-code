// KJC-TSK-1595 (the maintainer, 2026-11-13): each review under way has an AI review piece of its own at
// its agent's side; while at least one is out, the post keeps a ghost of the piece.
import { describe, expect, it } from 'vitest';

import { PIECE_WALK_MS, VISIT_MS, VISIT_SPOTS } from '../public/stage/piece-visit.js';
import { reviewsAt, withReviews } from '../public/stage/review-crew.js';

const xOf = (lane) => ({ a: 10, b: -10, main: 0 })[lane];
const zOf = () => 2;
const home = { x: 1, z: -3 };
// KJC-TSK-1846 (the maintainer, 2026-11-28): the reviewer is an agent at its own seat; the piece only
// goes to stamp a verdict, Karajan's gate.
const verdict = (lane, outcome = 'approved') => ({ type: 'review-verdict', verdict: outcome, reviewer: 'codex', lane });
const start = (lane, agent = 'codex') => ({ type: 'agent-activity', role: 'reviewer', agent, phase: 'start', lane });
const spotIn = (lane) => ({ x: xOf(lane) + VISIT_SPOTS.review.dx, z: zOf(lane) + VISIT_SPOTS.review.dz });
const at = (reviews, now) => reviewsAt(reviews, now, home, xOf, zOf);

describe('withReviews', () => {
  it('a verdict in each of two lanes: one piece in each, the first one stays where it is', () => {
    let reviews = withReviews({}, verdict('a'), 0);
    reviews = withReviews(reviews, verdict('b'), 100);
    const { pieces, ghost } = at(reviews, 100 + PIECE_WALK_MS);
    expect(pieces.map((p) => p.lane)).toEqual(['a', 'b']);
    expect(pieces[0].pose).toMatchObject({ ...spotIn('a'), away: true });
    expect(pieces[1].pose).toMatchObject({ ...spotIn('b'), away: true });
    expect(ghost).toBe(true);
  });

  it('a verdict in a lane with no review under way still sends a piece there for a while', () => {
    const reviews = withReviews({}, { type: 'review-verdict', verdict: 'approved', reviewer: 'agy', lane: 'b' }, 0);
    expect(at(reviews, PIECE_WALK_MS).pieces).toMatchObject([{ lane: 'b', pose: { ...spotIn('b') } }]);
  });

  it('other events and the agents themselves, the reviewer too, move no review piece', () => {
    const reviews = withReviews({}, verdict('a'), 0);
    expect(withReviews(reviews, { type: 'commit-gate', outcome: 'pass', lane: 'b' }, 5)).toBe(reviews);
    expect(withReviews(reviews, { type: 'agent-activity', role: 'coder', agent: 'claude', phase: 'start', lane: 'b' }, 5)).toBe(reviews);
    expect(withReviews(reviews, start('b'), 5)).toBe(reviews);
  });

  it('forgets a review once its piece is back at the post', () => {
    const reviews = withReviews({}, verdict('a'), 0);
    const back = reviews.a.until + PIECE_WALK_MS;
    expect(withReviews(reviews, verdict('b'), back)).not.toHaveProperty('a');
  });
});

describe('reviewsAt', () => {
  it('with no review, no piece out and no ghost: the post looks as it always did', () => {
    expect(at({}, 0)).toEqual({ pieces: [], ghost: false });
  });

  it('the ghost stays while one piece is still out, and goes once the last is back', () => {
    let reviews = withReviews({}, verdict('a'), 0);
    const aBack = reviews.a.until + PIECE_WALK_MS;
    reviews = withReviews(reviews, verdict('b'), aBack - PIECE_WALK_MS);
    const later = at(reviews, aBack + 10);
    expect(later.pieces.map((p) => p.lane)).toEqual(['b']);
    expect(later.ghost).toBe(true);
    expect(at(reviews, reviews.b.until + PIECE_WALK_MS + 1)).toEqual({ pieces: [], ghost: false });
  });

  it('each piece answers its own verdict', () => {
    let reviews = withReviews({}, verdict('a', 'rejected'), 0);
    reviews = withReviews(reviews, verdict('b', 'approved'), 0);
    const [a, b] = at(reviews, PIECE_WALK_MS + VISIT_MS / 2).pieces;
    expect(a.act.kind).toBe('refuse');
    expect(b.act.kind).toBe('approve');
  });
});
