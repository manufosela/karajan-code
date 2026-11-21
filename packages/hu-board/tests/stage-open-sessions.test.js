// KJC-TSK-1715 (the maintainer, 2026-11-21): the stage drew only the sessions at work, and a waiting
// one for two hours at most. The Sentinel now says which sessions are open (HU-4745): "open" at the
// start and at each prompt, with the host's pid, and "close" at the end. An open session waits at its
// desk while its pid lives (with no pid, until twelve hours without a line); a closed one is gone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activityEvent } from '../src/stage-feed.js';
import { lastStageState } from '../src/stage-state.js';
import { withEvent } from '../public/stage/rest.js';
import { withActivity } from '../public/stage/workers.js';

let tmp, proj;
const traces = () => join(proj, '.karajan', 'traces', 'agent-activity.jsonl');
const jsonl = (...rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const line = (at, phase, id, extra = {}) => ({ at, agent: 'claude', role: 'host', phase, id, ...extra });
const now = Date.parse('2026-11-21T12:00:00Z');
const state = (options = {}) => lastStageState(proj, { now, nameOf: () => null, waitOf: () => null, alive: () => true, ...options });

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hu-board-open-sessions-'));
  proj = join(tmp, 'proj');
  mkdirSync(join(proj, '.karajan', 'traces'), { recursive: true });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('the Sentinel\'s presence line', () => {
  it('reads open with its pid, and close', () => {
    expect(activityEvent(JSON.stringify(line('t', 'open', 's1', { pid: 42 })))).toMatchObject({ phase: 'open', id: 's1', pid: 42 });
    expect(activityEvent(JSON.stringify(line('t', 'close', 's1')))).toMatchObject({ phase: 'close', id: 's1' });
    expect(activityEvent(JSON.stringify(line('t', 'open', 's1', { pid: 'x' })))).not.toHaveProperty('pid');
  });
});

describe('the sessions open when the stage opens', () => {
  it('an open session that is not at work waits at its desk, however long ago it ended', () => {
    writeFileSync(traces(), jsonl(
      line('2026-11-21T06:00:00Z', 'open', 's1', { pid: 42 }),
      line('2026-11-21T06:01:00Z', 'start', 's1', { tool: 'Bash' }),
      line('2026-11-21T06:02:00Z', 'end', 's1'),
    ));
    expect(state().working).toMatchObject([{ agent: 'claude', role: 'host', id: 's1', waiting: 'person' }]);
    expect(state({ waitOf: () => 'process' }).working[0].waiting).toBe('process');
  });

  it('one at work is drawn at work, once', () => {
    writeFileSync(traces(), jsonl(line('2026-11-21T11:58:00Z', 'open', 's1', { pid: 42 }), line('2026-11-21T11:59:00Z', 'start', 's1', { tool: 'Edit' })));
    const { working } = state();
    expect(working).toHaveLength(1);
    expect(working[0]).not.toHaveProperty('waiting');
  });

  it('a closed session is gone, even one that has just ended waiting', () => {
    writeFileSync(traces(), jsonl(
      line('2026-11-21T11:50:00Z', 'open', 's1', { pid: 42 }),
      line('2026-11-21T11:51:00Z', 'end', 's1'),
      line('2026-11-21T11:52:00Z', 'close', 's1'),
    ));
    expect(state({ waitOf: () => 'person' }).working).toEqual([]);
  });

  it('one whose host process died is not open', () => {
    writeFileSync(traces(), jsonl(line('2026-11-21T11:00:00Z', 'open', 's1', { pid: 42 })));
    expect(state({ alive: (pid) => pid !== 42 }).working).toEqual([]);
  });

  it('with no pid, it is open until twelve hours without a line', () => {
    writeFileSync(traces(), jsonl(line('2026-11-21T01:00:00Z', 'open', 's1')));
    expect(state().working.map((w) => w.id)).toEqual(['s1']);
    writeFileSync(traces(), jsonl(line('2026-11-20T23:00:00Z', 'open', 's1')));
    expect(state().working).toEqual([]);
  });

  it('every open session of the lane is drawn, not only the latest', () => {
    writeFileSync(traces(), jsonl(line('2026-11-21T08:00:00Z', 'open', 'old', { pid: 1 }), line('2026-11-21T11:00:00Z', 'open', 'new', { pid: 2 })));
    expect(state().working.map((w) => w.id)).toEqual(['old', 'new']);
  });
});

describe('the live stream', () => {
  const event = (phase, extra = {}) => ({ type: 'agent-activity', agent: 'claude', role: 'host', phase, id: 's1', lane: 'main', at: 'x', ...extra });

  it('a session that opens sits waiting; one already there stays as it is; one that closes leaves', () => {
    let workers = withActivity([], event('open'), 0);
    expect(workers).toMatchObject([{ id: 's1', waiting: 'person' }]);
    workers = withActivity(workers, event('start'), 1000);
    expect(withActivity(workers, event('open'), 2000)).toBe(workers);
    expect(withActivity(workers, event('close'), 3000)[0].leftAt).toBe(3000);
  });

  it('the lane\'s state keeps an open session waiting and drops a closed one', () => {
    let lane = withEvent({}, event('open'));
    expect(lane.working).toMatchObject([{ id: 's1', waiting: 'person' }]);
    lane = withEvent(withEvent(lane, event('start')), event('open'));
    expect(lane.working[0]).not.toHaveProperty('waiting');
    expect(withEvent(lane, event('close')).working).toEqual([]);
  });
});
