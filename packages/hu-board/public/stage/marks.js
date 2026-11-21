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
      // KJC-BUG-0620: a denial of a session with no robot seen marks no workshop.
      if (event.unseen) return null;
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
 * KJC-TSK-1711 (the maintainer, 2026-11-21): three drones at once wrote three texts over each
 * other and none could be read. The marks queue and show one at a time, a little behind Karajan;
 * the queue keeps the newest few, so it never runs far behind.
 */
export const MAX_QUEUED = 4;
/** The last part of a mark's time, in which it fades. */
const FADE_MS = 1200;

/**
 * The marks after an event at `now`, queued one after another (KJC-TSK-1711): a newer mark of a
 * kind replaces the one of that kind still waiting in its lane; the same mark again while the
 * older waits or shows counts, ×N (KJC-TSK-1582).
 */
export function withMark(marks, event, now) {
  const mark = markOf(event);
  if (!mark) return marks;
  const lane = event.lane ?? 'main';
  const live = marks.filter((m) => now - m.at < MARK_MS);
  const same = live.find((m) => m.lane === lane && m.kind === mark.kind && m.base === mark.text);
  if (same) {
    const count = same.count + 1;
    return live.map((m) => (m === same ? { ...m, count, text: `${mark.text} ×${count}` } : m));
  }
  const showing = live.filter((m) => m.at <= now);
  const waiting = [...live.filter((m) => m.at > now && (m.lane !== lane || m.kind !== mark.kind)),
    { ...mark, base: mark.text, count: 1, lane }].slice(-MAX_QUEUED);
  const start = Math.max(now, ...showing.map((m) => m.at + MARK_MS));
  return [...showing, ...waiting.map((m, i) => ({ ...m, at: start + i * MARK_MS }))];
}

/** The marks showing at `now`, each with how strongly: 1 while it holds, fading to 0 at its end. */
export const marksAt = (marks, now) => marks
  .filter((m) => now >= m.at && now - m.at < MARK_MS)
  .map((m) => ({ ...m, level: Math.min(1, (MARK_MS - (now - m.at)) / FADE_MS) }));
