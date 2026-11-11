// KJC-TSK-1539 (issue 3853): each lane says whether it is working, waiting or finished, from
// facts: its agents at work, its pending handoffs, its cards and its branch against its upstream.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { branchFacts, parseBranch } from '../src/lane-branch.js';
import { laneStatus, laneStatuses, statusLine } from '../public/stage/lane-status.js';

const synced = { head: 'feat/x', upstream: 'origin/feat/x', gone: false, ahead: 0 };
const card = (status, lane = 'x') => ({ id: 'HU-1', status, lane, at: '2026-11-11T10:00:00Z' });

describe('laneStatus', () => {
  it('works while an agent of the lane is at work, whatever else it holds', () => {
    expect(laneStatus({ lane: 'x', working: [{ role: 'host' }], mail: 2, branch: synced }, [card('done')]).state).toBe('working');
  });

  it('waits for a person while it holds a pending handoff', () => {
    expect(laneStatus({ lane: 'x', mail: 1, branch: synced })).toEqual({ state: 'waiting-person', why: 'waits for you: 1 handoff' });
  });

  it('is finished when its branch is merged (its upstream is gone) or its cards are done', () => {
    expect(laneStatus({ lane: 'x', branch: { ...synced, gone: true } }).state).toBe('finished');
    expect(laneStatus({ lane: 'x', branch: { ...synced, ahead: 3 } }, [card('done')])).toEqual({ state: 'finished', why: 'HU-1 done' });
  });

  it('waits for a merge when its branch is pushed whole and nobody works', () => {
    expect(laneStatus({ lane: 'x', branch: synced }, [card('running')])).toEqual({ state: 'waiting-merge', why: 'pushed, waits for merge' });
  });

  it('is idle with a running card, unpushed work and no activity', () => {
    expect(laneStatus({ lane: 'x', branch: { ...synced, ahead: 2 } }, [card('running'), card('done', 'other')])).toEqual({ state: 'idle', why: 'HU-1 running, no activity' });
    expect(laneStatus({ lane: 'x', branch: { head: 'feat/x', upstream: null, gone: false, ahead: 0 } }).why).toBe('no activity');
  });

  it('is unknown, never working, when its branch cannot be read', () => {
    expect(laneStatus({ lane: 'x', branch: null }, [card('running')])).toEqual({ state: 'unknown', why: 'branch unreadable' });
  });

  it('reads the main checkout without a branch: idle unless it works or waits', () => {
    expect(laneStatus({ lane: 'main' }).state).toBe('idle');
  });
});

// KJC-TSK-1540: the scene recomputes it live, from the agents at work and the mailbox.
describe('laneStatuses', () => {
  const lanes = [{ lane: 'main' }, { lane: 'x', branch: synced }];

  it('gives every lane of the hall its status, a lane born live with no branch read as unknown', () => {
    const working = [{ lane: 'main', role: 'host' }];
    const statuses = laneStatuses(['main', 'x', 'late'], { lanes, working, cards: [] }, new Map([['x', 1]]));
    expect([...statuses].map(([lane, s]) => [lane, s.state])).toEqual([['main', 'working'], ['x', 'waiting-person'], ['late', 'unknown']]);
  });

  it('an agent at work in a lane makes it working without a reload', () => {
    const statuses = laneStatuses(['x'], { lanes, working: [{ lane: 'x', role: 'coder' }], cards: [] }, new Map());
    expect(statuses.get('x').state).toBe('working');
  });
});

// KJC-TSK-1546: a lane's note says what it waits for, in quotes, as text.
describe('a lane with a note', () => {
  it('keeps it in its status and shows it quoted instead of the reason, never while it works', () => {
    const lanes = [{ lane: 'x', branch: { ...synced, ahead: 2 }, note: "waits for Jorge's review" }];
    const status = laneStatuses(['x'], { lanes }, new Map()).get('x');
    expect(status).toEqual({ state: 'idle', why: 'no activity', note: "waits for Jorge's review" });
    expect(statusLine(status)).toBe("“waits for Jorge's review”");
    expect(statusLine({ state: 'working', why: null, note: 'x' })).toBe('');
  });
});

describe('statusLine', () => {
  it('says nothing for a working lane, what it waits for, and the state with its reason otherwise', () => {
    expect(statusLine({ state: 'working', why: null })).toBe('');
    expect(statusLine({ state: 'waiting-merge', why: 'pushed, waits for merge' })).toBe('pushed, waits for merge');
    expect(statusLine({ state: 'finished', why: 'branch merged' })).toBe('finished: branch merged');
    expect(statusLine({ state: 'unknown', why: 'branch unreadable' })).toBe('unknown: branch unreadable');
  });
});

describe('parseBranch', () => {
  it('reads the head, the upstream and how far ahead it is', () => {
    const out = '# branch.oid abc\n# branch.head feat/x\n# branch.upstream origin/feat/x\n# branch.ab +2 -0\n';
    expect(parseBranch(out)).toEqual({ head: 'feat/x', upstream: 'origin/feat/x', gone: false, ahead: 2 });
  });

  it('takes an upstream with no ahead/behind line as gone', () => {
    expect(parseBranch('# branch.head feat/x\n# branch.upstream origin/feat/x\n').gone).toBe(true);
  });

  it('reads a branch never pushed, and nothing from a detached head', () => {
    expect(parseBranch('# branch.head feat/x\n')).toEqual({ head: 'feat/x', upstream: null, gone: false, ahead: 0 });
    expect(parseBranch('# branch.head (detached)\n')).toBeNull();
  });
});

describe('branchFacts over a temp lane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kj-lane-status-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'pipe' });

  it('reads a real branch, and null from a folder that is not a repository', () => {
    git('init', '-q', '-b', 'feat/x');
    writeFileSync(join(dir, 'a.txt'), 'a');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'a');
    expect(branchFacts(dir)).toEqual({ head: 'feat/x', upstream: null, gone: false, ahead: 0 });
    expect(branchFacts(join(dir, 'missing'))).toBeNull();
  });
});
