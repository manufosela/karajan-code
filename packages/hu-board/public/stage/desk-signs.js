// KJC-TSK-1588 (decided by the maintainer on 2026-11-13, «Sigue su vida»): with no agent at work,
// a card in progress stays on its desk under a sign of its lane's state, in one colour per state;
// once the board closes it, a robot takes it to the wall's Done column. Pure: live.js draws them.

/** What each lane state says over its desk, and its colour (stage.html, .stage-desk-<tone>). */
const SIGN = {
  'waiting-merge': { text: 'waits for merge', tone: 'merge' },
  failed: { text: 'CI failed', tone: 'failed' },
  idle: { text: 'stopped, no agent', tone: 'stopped' },
  'waiting-person': { text: 'waits for you', tone: 'person' },
  finished: { text: 'merged', tone: 'done' },
};

/**
 * The sign over each desk that holds a card in progress while its lane is not working:
 * `statuses` by lane (laneStatuses), `cards` each at its own lane (atHome).
 */
export function deskSigns(statuses, cards) {
  const running = Map.groupBy(cards.filter((c) => c.status === 'running' && c.lane), (c) => c.lane);
  return [...statuses].flatMap(([lane, { state }]) => {
    const sign = SIGN[state];
    const here = running.get(lane);
    if (!sign || !here) return [];
    return [{ lane, text: `${here.map((c) => c.id).join(', ')} · ${sign.text}`, tone: sign.tone }];
  });
}

/** The cards in progress in `held` that `fresh` says done, as the card events a courier answers. */
export function closedCards(held, fresh) {
  const was = new Map(held.map((c) => [c.id, c.status]));
  return fresh
    .filter((c) => c.status === 'done' && was.get(c.id) === 'running')
    .map((c) => ({ type: 'card', action: 'move', id: c.id, status: 'done', lane: c.lane }));
}
