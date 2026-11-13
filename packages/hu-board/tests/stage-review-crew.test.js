// KJC-TSK-1595 (the maintainer, 2026-11-13): each review under way has an AI review piece of its own at
// its agent's side; while at least one is out, the post keeps a ghost of the piece.
import { describe, expect, it } from 'vitest';

import { PIECE_WALK_MS, VISIT_MS, VISIT_SPOTS } from '../public/stage/piece-visit.js';
import { reviewsAt, withReviews } from '../public/stage/review-crew.js';

const xOf = (lane) => ({ a: 10, b: -10, main: 0 })[lane];
const zOf = () => 2;
const home = { x: 1, z: -3 };
const start = (lane, agent = 'codex') => ({ type: 'agent-activity', role: 'reviewer', agent, phase: 'start', lane });
const end = (lane) => ({ type: 'agent-activity', role: 'reviewer', agent: 'codex', phase: 'end', lane });
const spotIn = (lane) => ({ x: xOf(lane) + VISIT_SPOTS.review.dx, z: zOf(lane) + VISIT_SPOTS.review.dz });
const at = (reviews, now) => reviewsAt(reviews, now, home, xOf, zOf);

describe('withReviews', () => {
  it('a review in each of two lanes: one piece in each, the first one stays where it is', () => {
    let reviews = withReviews({}, start('a'), 0);
    reviews = withReviews(reviews, start('b', 'agy'), 1000);
    const { pieces, ghost } = at(reviews, 1000 + PIECE_WALK_MS);
    expect(pieces.map((p) => [p.lane, p.by])).toEqual([['a', 'codex'], ['b', 'agy']]);
    expect(pieces[0].pose).toMatchObject({ ...spotIn('a'), away: true });
    expect(pieces[1].pose).toMatchObject({ ...spotIn('b'), away: true });
    expect(ghost).toBe(true);
  });

  it('a verdict in a lane with no review under way still sends a piece there for a while', () => {
    const reviews = withReviews({}, { type: 'review-verdict', verdict: 'approved', reviewer: 'agy', lane: 'b' }, 0);
    expect(at(reviews, PIECE_WALK_MS).pieces).toMatchObject([{ lane: 'b', pose: { ...spotIn('b') } }]);
  });

  it('other events and other roles move no review piece', () => {
    const reviews = withReviews({}, start('a'), 0);
    expect(withReviews(reviews, { type: 'commit-gate', outcome: 'pass', lane: 'b' }, 5)).toBe(reviews);
    expect(withReviews(reviews, { type: 'agent-activity', role: 'coder', agent: 'claude', phase: 'start', lane: 'b' }, 5)).toBe(reviews);
  });

  it('forgets a review once its piece is back at the post', () => {
    let reviews = withReviews({}, start('a'), 0);
    reviews = withReviews(reviews, end('a'), 100);
    const back = reviews.a.until + PIECE_WALK_MS;
    expect(withReviews(reviews, start('b'), back)).not.toHaveProperty('a');
  });
});

describe('reviewsAt', () => {
  it('with no review, no piece out and no ghost: the post looks as it always did', () => {
    expect(at({}, 0)).toEqual({ pieces: [], ghost: false });
  });

  it('the ghost stays while one piece is still out, and goes once the last is back', () => {
    let reviews = withReviews({}, start('a'), 0);
    reviews = withReviews(reviews, end('a'), 100);
    reviews = withReviews(reviews, start('b'), 200);
    const aBack = reviews.a.until + PIECE_WALK_MS;
    const later = at(reviews, aBack + 10);
    expect(later.pieces.map((p) => p.lane)).toEqual(['b']);
    expect(later.ghost).toBe(true);
    reviews = withReviews(reviews, end('b'), aBack + 20);
    expect(at(reviews, reviews.b.until + PIECE_WALK_MS + 1)).toEqual({ pieces: [], ghost: false });
  });

  it('each piece leans over its own work and answers its own verdict', () => {
    let reviews = withReviews({}, start('a'), 0);
    reviews = withReviews(reviews, { type: 'review-verdict', verdict: 'rejected', lane: 'a' }, PIECE_WALK_MS + VISIT_MS);
    reviews = withReviews(reviews, start('b'), 0);
    const now = PIECE_WALK_MS + VISIT_MS + 100;
    const [a, b] = at(reviews, now).pieces;
    expect(a.act.kind).toBe('refuse');
    expect(b.act.kind).toBe('inspect');
  });
});
