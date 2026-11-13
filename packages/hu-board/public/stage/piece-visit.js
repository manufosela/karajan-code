// KJC-TSK-1517 (decided by the maintainer on 2026-11-11): the pieces of the method
// work where they act. A verdict, a commit or a seal sends AI review, Git gates or
// the Ledger from its post to the workshop of its lane; it stays a while and goes
// back. Pure: live.js moves the pieces with what this says.
import { WORKSHOP } from './layout.js';
import { METHOD_PIECES } from './director.js';

/** How long a piece glides each way, and how long it stays at the workshop. */
export const PIECE_WALK_MS = 1800;
export const VISIT_MS = 2400;
const PIECE_OF = { 'review-verdict': 'review', 'commit-gate': 'gates', 'ledger-seal': 'ledger' };
// KJC-TSK-1524: kj review's checks name their piece.
const pieceOf = (event) => (event?.type === 'method-check' && METHOD_PIECES.has(event.piece) ? event.piece : PIECE_OF[event?.type]);
/**
 * Where each piece stands in a workshop, from its centre: in a row behind the bench, a piece
 * width apart, the gates behind their bar at the back corner and the Ledger behind kaRAGan;
 * KJC-TSK-1524: TDD, Sonar and the Steward in a second row behind them.
 */
export const VISIT_SPOTS = {
  review: { dx: -0.2, dz: -2.1 }, gates: { dx: 1.4, dz: -2.2 }, ledger: { dx: -1.5, dz: -2.2 },
  tdd: { dx: -1.2, dz: -3.1 }, sonar: { dx: 0.2, dz: -3.1 }, steward: { dx: 1.6, dz: -3.1 },
};

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
const facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const spotOf = (visit, xOf, zOf) => {
  const { dx, dz } = VISIT_SPOTS[visit.piece];
  return { x: xOf(visit.lane) + dx, z: zOf(visit.lane) + dz };
};

/** KJC-TSK-1528: a review that never says it ended sends the AI review piece back after this long. */
export const REVIEW_MAX_MS = 15 * 60 * 1000;

/**
 * KJC-TSK-1528 (decided by the maintainer on 2026-11-11): the AI review piece does the reviewing.
 * A reviewer's start sends it to the lane with the agent's name for as long as the review lasts;
 * its end sends it back (the verdict, just after, keeps it a while).
 */
function withReviewer(visits, event, now) {
  const lane = event.lane ?? 'main';
  const old = visits.review;
  if (event.phase === 'start') {
    const until = now + PIECE_WALK_MS + REVIEW_MAX_MS;
    const here = old?.lane === lane && now < old.until;
    return { ...visits, review: here ? { ...old, until, by: event.agent } : { ...withVisit(visits, { type: 'review-verdict', lane }, now).review, until, by: event.agent } };
  }
  if (old?.lane !== lane || now >= old.until) return visits;
  return { ...visits, review: { ...old, until: Math.max(now, old.at + PIECE_WALK_MS) } };
}

/** KJC-TSK-1583: what the event says of the work the piece looked at; nothing when it says nothing yet. */
function toneOf(event) {
  switch (event.type) {
    case 'review-verdict':
      if (!event.verdict) return undefined; // the reviewer's start sends the piece before any verdict
      return event.verdict === 'approved' ? 'approve' : 'refuse';
    case 'commit-gate': return event.outcome === 'pass' ? 'approve' : 'refuse';
    case 'ledger-seal': return event.decision === 'deny' ? 'refuse' : 'approve';
    case 'method-check': return event.outcome === 'pass' ? 'approve' : 'refuse';
    default: return undefined;
  }
}

/** The visits after an event at `now`, by piece: a piece already in that lane's workshop stays longer. */
export function withVisit(visits, event, now) {
  if (event?.type === 'agent-activity') return event.role === 'reviewer' ? withReviewer(visits, event, now) : visits;
  const piece = pieceOf(event);
  if (!piece) return visits;
  const lane = event.lane ?? 'main';
  const old = visits[piece];
  const tone = toneOf(event);
  if (old?.lane === lane && now < old.until) {
    return { ...visits, [piece]: { ...old, until: Math.max(old.until, now + VISIT_MS), ...(tone ? { tone, toneAt: now } : {}) } };
  }
  // Called away while out (going, there or coming back): the new trip starts where the old one
  // has the piece now. Once the old one reached its workshop, where it set off from no longer counts.
  const out = old && now < old.until + PIECE_WALK_MS;
  const arrived = old && now >= old.at + PIECE_WALK_MS;
  const from = out ? { ...old, from: arrived ? null : old.from } : null;
  return { ...visits, [piece]: { piece, lane, at: now, until: now + PIECE_WALK_MS + VISIT_MS, from, tone, toneAt: tone ? now : undefined } };
}

/** KJC-TSK-1583: how long a piece inspects at the workshop, and how long it answers. */
export const INSPECT_MS = 800;
export const GESTURE_MS = 900;

/**
 * What a piece does at the workshop at `now`: it inspects until it knows the result (and for a
 * moment at least), then stamps (approve) or shakes its head (refuse), `k` from 0 to 1, then
 * rests. Nothing while it walks or is at its post.
 */
export function gestureAt(visit, now) {
  const arrive = visit ? visit.at + PIECE_WALK_MS : Infinity;
  if (now < arrive || now >= visit.until) return null;
  const start = visit.tone ? Math.max(arrive + INSPECT_MS, visit.toneAt) : Infinity;
  if (now < start) return { kind: 'inspect', k: ((now - arrive) % INSPECT_MS) / INSPECT_MS };
  const k = (now - start) / GESTURE_MS;
  return k < 1 ? { kind: visit.tone, k } : null;
}

/** Where a piece is at `now`, where it faces, whether it glides and whether it is off its post. */
export function pieceAt(visit, now, home, xOf, zOf = () => WORKSHOP.z) {
  const rest = { x: home.x, z: home.z, yaw: 0, walking: false, away: false };
  const t = visit ? now - visit.at : -1;
  if (t < 0 || now >= visit.until + PIECE_WALK_MS) return rest;
  const spot = spotOf(visit, xOf, zOf);
  if (t < PIECE_WALK_MS) {
    const from = visit.from ? pieceAt(visit.from, visit.at, home, xOf, zOf) : home;
    return { ...lerp(from, spot, t / PIECE_WALK_MS), yaw: facing(from, spot), walking: true, away: true };
  }
  if (now < visit.until) return { ...spot, yaw: 0, walking: false, away: true };
  return { ...lerp(spot, home, (now - visit.until) / PIECE_WALK_MS), yaw: facing(spot, home), walking: true, away: true };
}
