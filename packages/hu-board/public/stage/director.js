// KJC-TSK-1406 (ADR 0046): the stage director. It turns the events of the
// board stream into cues for the method's pieces, and folds a burst of the
// same event into one cue with a count, so fifty denials in a second are one
// flash marked x50, not fifty. No three.js here: the scene reads the cues.

/** How long a cue plays, in ms. A same event inside it joins the cue. */
export const CUE_MS = 1400;

const tone = (passed) => (passed ? 'approve' : 'refuse');

/** The piece an event moves, and how; null for what the stage does not draw. */
export function cueFor(event) {
  switch (event?.type) {
    case 'sentinel-deny':
      return { piece: 'sentinel', tone: 'refuse', key: 'sentinel-deny' };
    case 'review-verdict':
      return { piece: 'review', tone: tone(event.verdict === 'approved'), key: `review-verdict:${event.verdict}` };
    case 'ledger-seal':
      return { piece: 'ledger', tone: tone(event.decision !== 'deny'), key: `ledger-seal:${event.decision}` };
    default:
      return null;
  }
}

/** 0 at the start and the end of a cue, 1 at its middle. */
export function cueLevel(cue, now) {
  const x = (now - cue.at) / CUE_MS;
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
}

export function createDirector() {
  let cues = [];
  return {
    /** Takes one stream event at time `now` (ms). */
    push(event, now) {
      const cue = cueFor(event);
      if (!cue) return;
      const open = cues.find((c) => c.key === cue.key && now - c.at < CUE_MS);
      if (open) open.count += 1;
      else cues.push({ ...cue, at: now, count: 1, event });
    },
    /** The cues still playing at `now`, oldest first. */
    active(now) {
      cues = cues.filter((c) => now - c.at < CUE_MS);
      return cues;
    },
  };
}
