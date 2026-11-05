// KJC-TSK-1437 (ADR 0048): what Karajan's roles do shows where it happens. A
// review verdict, a commit at the git gates and a Ledger seal each leave a mark
// on the workshop of the lane they belong to, which fades after a while; the
// gates of that workshop light up with the commit. Pure: live.js draws the marks.

/** How long a mark stays on the workshop, in ms. */
export const MARK_MS = 6000;

const tone = (passed) => (passed ? 'approve' : 'refuse');

/** The mark an event leaves, or null. */
function markOf(event) {
  switch (event?.type) {
    case 'review-verdict':
      return { kind: 'review', text: `${event.verdict} by ${event.reviewer ?? 'a reviewer'}`, tone: tone(event.verdict === 'approved') };
    case 'commit-gate':
      return { kind: 'gates', text: event.outcome === 'pass' ? 'commit passed' : `commit refused (${event.rule})`, tone: tone(event.outcome === 'pass') };
    case 'ledger-seal':
      return { kind: 'ledger', text: `sealed ${event.decision} at ${event.chokepoint}`, tone: tone(event.decision !== 'deny') };
    default:
      return null;
  }
}

/** The marks after an event at `now`: a newer mark of a kind replaces the older one in its lane. */
export function withMark(marks, event, now) {
  const mark = markOf(event);
  if (!mark) return marks;
  const lane = event.lane ?? 'main';
  return [...marks.filter((m) => m.lane !== lane || m.kind !== mark.kind), { ...mark, lane, at: now }];
}

/** The marks still showing at `now`, each with how strongly (1 when new, fading to 0). */
export const marksAt = (marks, now) => marks
  .filter((m) => now >= m.at && now - m.at < MARK_MS)
  .map((m) => ({ ...m, level: 1 - (now - m.at) / MARK_MS }));
