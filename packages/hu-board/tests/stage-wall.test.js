// KJC-TSK-1459 (ADR 0050): the factory's task board wall, its three columns laid out.
import { describe, expect, it } from 'vitest';

import { WALL_ROWS, wallColumns } from '../public/stage/wall-layout.js';

const card = (id, status, at = '2026-11-08T10:00:00Z', title = `Story ${id}`) => ({ id, title, status, at });

describe('wallColumns', () => {
  it('puts each card in its column, newest first, and leaves failed and skipped ones off', () => {
    const cols = wallColumns([
      card('HU-1', 'pending', '2026-11-08T10:00:00Z'), card('HU-2', 'pending', '2026-11-08T11:00:00Z'),
      card('HU-3', 'running'), card('HU-4', 'done'), card('HU-5', 'skipped'), card('HU-6', 'failed'),
    ]);
    expect(cols.map((c) => [c.title, c.cards.map((x) => x.id), c.more])).toEqual([
      ['To do', ['HU-2', 'HU-1'], 0], ['In progress', ['HU-3'], 0], ['Done', ['HU-4'], 0],
    ]);
  });

  it('shows the newest cards that fit and says how many more there are', () => {
    const many = Array.from({ length: WALL_ROWS + 3 }, (_, i) => card(`HU-${i}`, 'done', new Date(Date.UTC(2026, 10, 8, i)).toISOString()));
    const done = wallColumns(many)[2];
    expect(done.cards).toHaveLength(WALL_ROWS);
    expect(done.cards[0].id).toBe(`HU-${WALL_ROWS + 2}`);
    expect(done.more).toBe(3);
  });

  it('a card kj only moved shows its id alone', () => {
    expect(wallColumns([card('HU-9', 'running', undefined, null)])[1].cards[0]).toEqual({ id: 'HU-9', title: '' });
  });
});
