// KJC-TSK-1458 (ADR 0050): the factory's task board, folded from the card trace:
// the last line of each card decides where it is.
import { describe, expect, it } from 'vitest';

import { boardLine, columnOf, mapName, mergeCards, withCard } from '../public/stage/cards.js';

const card = (over) => ({ type: 'card', at: '2026-11-08T10:00:00.000Z', action: 'add', id: 'HU-1', title: 'Login', status: 'pending', queued: false, ...over });

describe('withCard', () => {
  it('pins a new card, with its lane, and moves it as it moves', () => {
    const added = withCard([], card({ lane: 'main' }));
    expect(added).toEqual([{ id: 'HU-1', title: 'Login', status: 'pending', lane: 'main', at: '2026-11-08T10:00:00.000Z' }]);
    const moved = withCard(added, card({ action: 'move', title: null, status: 'running', lane: 'feat-x', at: '2026-11-08T11:00:00.000Z' }));
    expect(moved).toEqual([{ id: 'HU-1', title: 'Login', status: 'running', lane: 'feat-x', at: '2026-11-08T11:00:00.000Z' }]);
  });

  it('a card kj only moved still shows, by its id', () => {
    expect(withCard([], card({ action: 'move', title: null, status: 'running' }))[0]).toMatchObject({ id: 'HU-1', title: null, status: 'running' });
  });

  it('a move queued without network moves nothing', () => {
    const added = withCard([], card());
    expect(withCard(added, card({ action: 'move', status: 'done', queued: true }))).toBe(added);
  });

  it('leaves any other event as it was', () => {
    const cards = withCard([], card());
    expect(withCard(cards, { type: 'sentinel-deny' })).toBe(cards);
  });
});

describe('columnOf', () => {
  it('to do, in progress and done; failed and skipped leave the wall', () => {
    expect(['pending', 'running', 'done', 'failed', 'skipped'].map(columnOf)).toEqual(['todo', 'doing', 'done', null, null]);
  });
});

describe('mergeCards', () => {
  it('keeps the newest line of a card that went through several lanes', () => {
    const main = [{ id: 'HU-1', title: 'Login', status: 'pending', lane: 'main', at: '2026-11-08T10:00:00.000Z' }];
    const lane = [{ id: 'HU-1', title: null, status: 'running', lane: 'feat-x', at: '2026-11-08T11:00:00.000Z' }];
    expect(mergeCards([main, lane])).toEqual([{ id: 'HU-1', title: 'Login', status: 'running', lane: 'feat-x', at: '2026-11-08T11:00:00.000Z' }]);
  });
});

// KJC-TSK-1460 (ADR 0050, point 6): far away on the map, a factory says how many cards it has in progress.
describe('mapName', () => {
  it('adds the cards in progress to the factory name, and nothing when there are none', () => {
    const cards = [{ id: 'HU-1', status: 'running' }, { id: 'HU-2', status: 'running' }, { id: 'HU-3', status: 'pending' }];
    expect(mapName('grebla', cards)).toBe('grebla · 2 in progress');
    expect(mapName('grebla', [{ id: 'HU-1', status: 'running' }])).toBe('grebla · 1 in progress');
    expect(mapName('grebla', [{ id: 'HU-3', status: 'done' }])).toBe('grebla');
  });
});

describe('boardLine', () => {
  it('says how many cards each column holds, and nothing without cards', () => {
    const cards = ['pending', 'pending', 'running', 'done', 'skipped'].map((status, i) => ({ id: `HU-${i}`, status }));
    expect(boardLine(cards)).toBe('Board: 2 to do, 1 in progress, 1 done');
    expect(boardLine([])).toBeNull();
  });
});
