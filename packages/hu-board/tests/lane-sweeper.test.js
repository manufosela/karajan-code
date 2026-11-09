// KJC-TSK-1479: the daemon calls kj worktree prune on every project it knows, one at a time.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLaneSweeper, sweepLanes, sweepTargets } from '../src/lane-sweeper.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'kj-sweep-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.useRealTimers(); });

const project = (name, lanes = true) => {
  const dir = join(root, name);
  mkdirSync(lanes ? join(dir, '.kj', 'worktrees') : dir, { recursive: true });
  return dir;
};
const silent = { log: vi.fn(), warn: vi.fn() };

describe('lane sweeper (KJC-TSK-1479)', () => {
  it('targets the main checkout of every real project that has kj lanes, once', () => {
    const a = project('a');
    const b = project('b', false);
    const dirs = { a, lane: a, b, t: project('t') };
    const projects = [{ id: 'a' }, { id: 'lane' }, { id: 'b' }, { id: 't', is_test: 1 }, { id: 'gone' }];
    expect(sweepTargets({ projects, dirOf: (id) => dirs[id] ?? null, canonical: (d) => d })).toEqual([a]);
  });

  it('prunes each target, logs what it retired and keeps going after a failure', async () => {
    const prune = vi.fn(async (dir) => {
      if (dir === 'x') throw new Error('boom');
      return { stdout: 'kept    a  reason\n✓ retired old (feat/old)\n' };
    });
    await sweepLanes({ targets: ['x', 'y'], prune, log: silent });
    expect(prune.mock.calls.map(([d]) => d)).toEqual(['x', 'y']);
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('x: boom'));
    expect(silent.log).toHaveBeenCalledWith('[lane-sweeper] y: ✓ retired old (feat/old)');
    expect(silent.log).toHaveBeenCalledTimes(1);
  });

  it('sweeps at start and every period, never two sweeps at once', async () => {
    vi.useFakeTimers();
    let release;
    const sweep = vi.fn(() => new Promise((r) => { release = r; }));
    const stop = startLaneSweeper({ sweep, everyMs: 1000, log: silent });
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(2);
    stop();
  });
});
