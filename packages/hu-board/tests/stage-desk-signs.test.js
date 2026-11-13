// KJC-TSK-1588 (decided by the maintainer on 2026-11-13, «Sigue su vida»): with no agent at work,
// the card stays on its desk with a coloured sign of its lane's state; closed, a robot takes it to Done.
import { describe, expect, it } from 'vitest';

import { closedCards, deskSigns } from '../public/stage/desk-signs.js';

const card = (id, lane, status = 'running') => ({ id, lane, status, title: id, at: '2026-11-13T08:00:00.000Z' });
const statuses = (entries) => new Map(entries);

describe('deskSigns', () => {
  it('a lane whose pull request waits for its merge says so over its card', () => {
    const signs = deskSigns(statuses([['HU-1-x', { state: 'waiting-merge', why: 'pipeline passed, waits for merge' }]]), [card('HU-1', 'HU-1-x')]);
    expect(signs).toEqual([{ lane: 'HU-1-x', text: 'HU-1 · waits for merge', tone: 'merge' }]);
  });

  it('a failed pipeline is red, a stopped lane grey, a person awaited amber', () => {
    const signs = deskSigns(statuses([
      ['a', { state: 'failed', why: 'pipeline failed' }],
      ['b', { state: 'idle', why: 'HU-2 running, no activity' }],
      ['c', { state: 'waiting-person', why: 'waits for you: 1 handoff' }],
    ]), [card('HU-1', 'a'), card('HU-2', 'b'), card('HU-3', 'c')]);
    expect(signs.map((s) => [s.text, s.tone])).toEqual([
      ['HU-1 · CI failed', 'failed'],
      ['HU-2 · stopped, no agent', 'stopped'],
      ['HU-3 · waits for you', 'person'],
    ]);
  });

  it('a merged lane whose card the board has not closed yet says merged', () => {
    expect(deskSigns(statuses([['a', { state: 'finished', why: 'branch merged' }]]), [card('HU-1', 'a')])[0])
      .toEqual({ lane: 'a', text: 'HU-1 · merged', tone: 'done' });
  });

  it('no sign while an agent works, on a desk without a card in progress, or for an unreadable lane', () => {
    const signs = deskSigns(statuses([
      ['a', { state: 'working', why: null }],
      ['b', { state: 'waiting-merge', why: 'pushed, waits for merge' }],
      ['c', { state: 'unknown', why: 'branch unreadable' }],
    ]), [card('HU-1', 'a'), card('HU-2', 'b', 'done'), card('HU-3', 'c')]);
    expect(signs).toEqual([]);
  });

  it('two cards on one desk share one sign', () => {
    expect(deskSigns(statuses([['a', { state: 'idle', why: 'x' }]]), [card('HU-1', 'a'), card('HU-2', 'a')])[0].text)
      .toBe('HU-1, HU-2 · stopped, no agent');
  });
});

describe('closedCards', () => {
  it('the cards that were in progress and the board now says done, as the events a robot answers', () => {
    const held = [card('HU-1', 'a'), card('HU-2', 'b'), card('HU-3', 'c', 'pending')];
    const fresh = [card('HU-1', 'a', 'done'), card('HU-2', 'b'), card('HU-3', 'c', 'done')];
    expect(closedCards(held, fresh)).toEqual([{ type: 'card', action: 'move', id: 'HU-1', status: 'done', lane: 'a' }]);
  });

  it('nothing when the cards did not change', () => {
    const held = [card('HU-1', 'a')];
    expect(closedCards(held, held)).toEqual([]);
  });
});
