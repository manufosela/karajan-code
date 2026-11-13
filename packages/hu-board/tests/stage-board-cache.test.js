// KJC-BUG-0547: a card line lost with a swept lane left its card in progress in kj stage. The
// main checkout keeps the shared board's cache: a newer status there wins on opening.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { boardStatuses, withBoardCache } from '../src/stage-board-cache.js';
import { laneStates } from '../src/stage-state.js';

let proj;
const cache = (name, hus, updatedAt = '2026-11-11T10:00:00Z') =>
  writeFileSync(join(proj, '.karajan', name), JSON.stringify({ hus, updatedAt, queue: [] }));
const card = (id, status, at = '2026-11-10T10:00:00Z') => ({ id, title: null, status, lane: 'main', at });

beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'stage-board-cache-'));
  mkdirSync(join(proj, '.karajan', 'traces'), { recursive: true });
});
afterEach(() => rmSync(proj, { recursive: true, force: true }));

describe('boardStatuses', () => {
  it('reads every board cache of the main checkout, and nothing when there is none', () => {
    expect(boardStatuses(proj).size).toBe(0);
    cache('board-cache.json', [{ short_id: 'HU-1', status: 'done' }]);
    cache('board-cache-linear.json', [{ short_id: 'LIN-2', status: 'running' }]);
    writeFileSync(join(proj, '.karajan', 'board-cache-bad.json'), '{oops');
    expect([...boardStatuses(proj)]).toEqual(expect.arrayContaining([
      ['HU-1', { status: 'done', at: '2026-11-11T10:00:00Z' }],
      ['LIN-2', { status: 'running', at: '2026-11-11T10:00:00Z' }],
    ]));
  });

  it('a card in two caches keeps the newer status, in either order', () => {
    cache('board-cache-a.json', [{ short_id: 'HU-9', status: 'running' }], '2026-11-11T09:00:00Z');
    cache('board-cache-b.json', [{ short_id: 'HU-9', status: 'done' }], '2026-11-11T10:00:00Z');
    expect(boardStatuses(proj).get('HU-9').status).toBe('done');
    cache('board-cache-a.json', [{ short_id: 'HU-9', status: 'failed' }], '2026-11-11T12:00:00Z');
    expect(boardStatuses(proj).get('HU-9').status).toBe('failed');
  });
});

describe('withBoardCache', () => {
  const statuses = new Map([['HU-1', { status: 'done', at: '2026-11-11T10:00:00Z' }], ['HU-2', { status: 'lost', at: '2026-11-11T10:00:00Z' }]]);

  it('a newer status in the cache wins; an older one, an unknown status or an absent card change nothing', () => {
    expect(withBoardCache([card('HU-1', 'running')], statuses)).toEqual([card('HU-1', 'done', '2026-11-11T10:00:00Z')]);
    expect(withBoardCache([card('HU-1', 'running', '2026-11-11T11:00:00Z')], statuses)[0].status).toBe('running');
    expect(withBoardCache([card('HU-2', 'running'), card('HU-3', 'running')], statuses).map((c) => c.status)).toEqual(['running', 'running']);
  });

  it('opens the stage with the ghost card done', () => {
    writeFileSync(join(proj, '.karajan', 'traces', 'cards.jsonl'), `${JSON.stringify({ at: '2026-11-10T10:00:00Z', action: 'move', id: 'HU-1', status: 'running' })}\n`);
    cache('board-cache.json', [{ short_id: 'HU-1', status: 'done' }]);
    expect(laneStates(proj)[0].cards.map((c) => [c.id, c.status])).toEqual([['HU-1', 'done']]);
  });
});
