// KJC-TSK-1595 (the maintainer, 2026-11-13): each review under way has an AI review piece of its own,
// which goes to its lane and stands at its agent's side; while at least one is out, the post keeps
// a ghost of the piece, and with none out it looks as it always did. One visit per lane, each the
// trip piece-visit.js already draws. Pure: live.js moves the copies with what this says.
import { PIECE_WALK_MS, gestureAt, pieceAt, withVisit } from './piece-visit.js';

const movesReview = (event) =>
  (event?.type === 'agent-activity' && event.role === 'reviewer') || event?.type === 'review-verdict';
const done = (visit, now) => now >= visit.until + PIECE_WALK_MS;

/** The reviews after an event at `now`, by lane; one whose piece is back at the post is forgotten. */
export function withReviews(reviews, event, now) {
  if (!movesReview(event)) return reviews;
  const lane = event.lane ?? 'main';
  const kept = Object.fromEntries(Object.entries(reviews).filter(([, visit]) => !done(visit, now)));
  const next = withVisit({ review: kept[lane] }, event, now).review;
  return next ? { ...kept, [lane]: next } : kept;
}

/**
 * Where each review's piece is at `now`, what it does there and whose review it is; `ghost` while
 * at least one is off the post. `home` is the post, `xOf`/`zOf` give a lane's workshop.
 */
export function reviewsAt(reviews, now, home, xOf, zOf) {
  const pieces = Object.entries(reviews)
    .map(([lane, visit]) => ({ lane, by: visit.by ?? null, pose: pieceAt(visit, now, home, xOf, zOf), act: gestureAt(visit, now) }))
    .filter((piece) => piece.pose.away);
  return { pieces, ghost: pieces.length > 0 };
}
