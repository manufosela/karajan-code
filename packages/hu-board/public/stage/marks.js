// KJC-TSK-1437 (ADR 0048): what Karajan's roles do shows where it happens. A
// review verdict, a commit at the git gates and a Ledger seal each leave a mark
// on the workshop of the lane they belong to, which fades after a while; the
// gates of that workshop light up with the commit. Pure: live.js draws the marks.

/** How long a mark stays on the workshop, in ms. */
export const MARK_MS = 6000;

const tone = (passed) => (passed ? 'approve' : 'refuse');
// KJC-TSK-1585: one colour per kind of answer; besides approve and refuse, a verdict that decides
// nothing (an error) is unsure, a Ledger exemption is exempt and a Sentinel denial is a stop.
const VERDICT_TONE = { approved: 'approve', rejected: 'refuse' };
const SEAL_TONE = { allow: 'approve', deny: 'refuse', exempt: 'exempt' };
// KJC-TSK-1582: what kj review checked, by piece, and how long a denial's reason may be.
const CHECKED = { tdd: 'TDD', sonar: 'Sonar', steward: 'Steward' };
const WHY_MAX = 48;

/** The reason of a denial without the Sentinel's name nor its explanation, short. */
function shortWhy(why) {
  const reason = String(why ?? '').replace(/^karajan sentinel:\s*/i, '').split(' — ')[0].trim();
  return reason.length > WHY_MAX ? `${reason.slice(0, WHY_MAX - 1)}…` : reason;
}

/** The mark an event leaves, or null. */
function markOf(event) {
  switch (event?.type) {
    case 'method-check':
      return CHECKED[event.piece]
        ? { kind: event.piece, text: `${CHECKED[event.piece]} ${event.outcome === 'pass' ? '✓' : '✗'}`, tone: tone(event.outcome === 'pass') }
        : null;
    case 'sentinel-deny':
      return { kind: 'sentinel', text: `✗ ${event.tool ?? 'a tool'}: ${shortWhy(event.why)}`, tone: 'stop' };
    case 'review-verdict':
      return { kind: 'review', text: `${event.verdict} by ${event.reviewer ?? 'a reviewer'}`, tone: VERDICT_TONE[event.verdict] ?? 'unsure' };
    case 'commit-gate':
      return { kind: 'gates', text: event.outcome === 'pass' ? 'commit passed' : `commit refused (${event.rule})`, tone: tone(event.outcome === 'pass') };
    case 'ledger-seal':
      return { kind: 'ledger', text: `sealed ${event.decision} at ${event.chokepoint}`, tone: SEAL_TONE[event.decision] ?? 'approve' };
    default:
      return null;
  }
}

/**
 * The marks after an event at `now`: a newer mark of a kind replaces the older one in its lane;
 * the same mark again while the older still shows counts, ×N (KJC-TSK-1582).
 */
export function withMark(marks, event, now) {
  const mark = markOf(event);
  if (!mark) return marks;
  const lane = event.lane ?? 'main';
  const same = marks.find((m) => m.lane === lane && m.kind === mark.kind && m.base === mark.text && now - m.at < MARK_MS);
  const count = (same?.count ?? 0) + 1;
  const text = count > 1 ? `${mark.text} ×${count}` : mark.text;
  return [...marks.filter((m) => m.lane !== lane || m.kind !== mark.kind), { ...mark, text, base: mark.text, count, lane, at: now }];
}

/** The marks still showing at `now`, each with how strongly (1 when new, fading to 0). */
export const marksAt = (marks, now) => marks
  .filter((m) => now >= m.at && now - m.at < MARK_MS)
  .map((m) => ({ ...m, level: 1 - (now - m.at) / MARK_MS }));
