// KJC-TSK-1587: a card closed by its merge leaves no trace line; the board refreshes the shared
// board's cache itself, so the stage stops showing it in progress.
import { describe, expect, it, vi } from 'vitest';

import { refreshCards, startCardRefresh } from '../src/card-refresh.js';
import { freshCards } from '../public/stage/cards.js';

const quiet = { warn: vi.fn() };
const card = (id, status, at) => ({ id, title: id, status, lane: 'main', at });

describe('freshCards', () => {
  const held = [card('HU-1', 'running', '2026-11-13T08:00:00Z'), card('HU-2', 'running', '2026-11-13T09:00:00Z')];

  it('takes a status the board says later than the one the stage holds', () => {
    const fresh = freshCards(held, [card('HU-1', 'done', '2026-11-13T08:30:00Z')]);
    expect(fresh.find((c) => c.id === 'HU-1').status).toBe('done');
  });

  it('keeps a live move newer than what the board says', () => {
    const fresh = freshCards(held, [card('HU-2', 'pending', '2026-11-13T08:30:00Z')]);
    expect(fresh).toBe(held);
  });

  it('gives back the same cards when nothing changed, so the wall is not repainted', () => {
    expect(freshCards(held, held.map((c) => ({ ...c })))).toBe(held);
  });

  it('adds a card the stage never saw', () => {
    expect(freshCards(held, [card('HU-3', 'running', '2026-11-13T09:30:00Z')]).map((c) => c.id)).toContain('HU-3');
  });
});

describe('refreshCards', () => {
  it('lists the board of each project in its own folder, one after the other', async () => {
    const run = vi.fn(async () => {});
    await refreshCards(['/a', '/b'], { run, log: quiet });
    expect(run.mock.calls.map(([dir]) => dir)).toEqual(['/a', '/b']);
  });

  it('a project whose board does not answer is logged and the next one is still refreshed', async () => {
    const log = { warn: vi.fn() };
    const run = vi.fn(async (dir) => { if (dir === '/a') throw new Error('no network'); });
    await refreshCards(['/a', '/b'], { run, log });
    expect(run).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith('[card-refresh] /a: no network');
  });
});

describe('startCardRefresh', () => {
  it('refreshes now and on every tick, never two at once, and stops', async () => {
    vi.useFakeTimers();
    let release;
    const refresh = vi.fn(() => new Promise((r) => { release = r; }));
    const stop = startCardRefresh({ targets: () => ['/a'], refresh, everyMs: 1000, log: quiet });
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1); // the first one still runs
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('KJ_CARD_REFRESH=off refreshes nothing', () => {
    const refresh = vi.fn(async () => {});
    startCardRefresh({ targets: () => ['/a'], refresh, env: { KJ_CARD_REFRESH: 'off' }, log: quiet })();
    expect(refresh).not.toHaveBeenCalled();
  });
});
