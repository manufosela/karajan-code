// KJC-TSK-1432 (ADR 0048): the stage sees every lane of a project, not only its main checkout.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listLanes } from '../src/lanes.js';
import { watchLanes } from '../src/stage-feed.js';
import { laneStates } from '../src/stage-state.js';

let proj;
const line = (o) => `${JSON.stringify(o)}\n`;
const lane = (...p) => join(proj, ...p);
const harness = (dir) => { mkdirSync(join(dir, '.karajan', 'harness'), { recursive: true }); return join(dir, '.karajan', 'harness'); };

beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'stage-lanes-'));
  harness(proj);
});
afterEach(() => rmSync(proj, { recursive: true, force: true }));

describe('listLanes', () => {
  it('is the main checkout first, then every worktree of kj and of claude by name', () => {
    mkdirSync(lane('.kj', 'worktrees', 'kj-stage'), { recursive: true });
    mkdirSync(lane('.claude', 'worktrees', 'agent-a1'), { recursive: true });
    writeFileSync(lane('.kj', 'worktrees', 'registry.json'), '{}');
    expect(listLanes(proj)).toEqual([
      { lane: 'main', dir: proj },
      { lane: 'agent-a1', dir: lane('.claude', 'worktrees', 'agent-a1') },
      { lane: 'kj-stage', dir: lane('.kj', 'worktrees', 'kj-stage') },
    ]);
  });

  it('is only the main checkout when the project has no worktrees', () => {
    expect(listLanes(proj)).toEqual([{ lane: 'main', dir: proj }]);
  });
});

describe('laneStates', () => {
  it('gives each lane its own last state', () => {
    const wt = lane('.kj', 'worktrees', 'kj-stage');
    appendFileSync(join(harness(wt), 'denials.jsonl'), line({ at: 't1', tool: 'Bash', why: 'no' }));
    const states = laneStates(proj);
    expect(states.map((s) => [s.lane, s.denial?.at ?? null])).toEqual([['main', null], ['kj-stage', 't1']]);
  });
});

describe('watchLanes', () => {
  let watchers, sent;
  const watch = (paths, opts) => {
    const w = Object.assign(new EventEmitter(), { paths, opts, closed: false, close() { this.closed = true; } });
    watchers.push(w);
    return w;
  };
  const watcherOf = (dir) => watchers.find((w) => w.paths === dir);
  beforeEach(() => { watchers = []; sent = []; });

  it('tags each event with its lane and follows a worktree born after it started', () => {
    const wt = lane('.kj', 'worktrees', 'kj-stage');
    const wtHarness = harness(wt);
    const stop = watchLanes(proj, (ev) => sent.push(ev), { project: 'demo', watch, warn: () => {} });
    appendFileSync(join(wtHarness, 'denials.jsonl'), line({ at: 't1', tool: 'Bash', why: 'no' }));
    watcherOf(wt).emit('add', join(wtHarness, 'denials.jsonl'));

    const late = lane('.claude', 'worktrees', 'agent-a1');
    const lateHarness = harness(late);
    const doors = watchers.find((w) => w.paths === proj && w.opts.depth === 2);
    doors.emit('addDir', late);
    doors.emit('addDir', join(late, '.karajan'));
    appendFileSync(join(lateHarness, 'commit-gate.jsonl'), line({ at: 't2', outcome: 'pass', rule: 'ok' }));
    watcherOf(late).emit('add', join(lateHarness, 'commit-gate.jsonl'));

    // KJC-TSK-1438: the RAG's answer note carries its lane like every other record.
    writeFileSync(join(wtHarness, 'rag-answer.json'), JSON.stringify({ at: 5, text: 'q', sources: ['a'] }));
    watcherOf(wt).emit('change', join(wtHarness, 'rag-answer.json'));
    // KJC-BUG-0546: a card line kj hu wrote from a lane into the main checkout keeps that lane.
    appendFileSync(join(harness(proj), 'cards.jsonl'), line({ at: 't3', action: 'move', id: 'HU-1', status: 'done', lane: 'kj-stage' }));
    watcherOf(proj).emit('add', join(harness(proj), 'cards.jsonl'));
    expect(sent.map((e) => [e.type, e.lane, e.project])).toEqual([
      ['sentinel-deny', 'kj-stage', 'demo'], ['commit-gate', 'agent-a1', 'demo'], ['rag-answer', 'kj-stage', 'demo'], ['card', 'kj-stage', 'demo'],
    ]);
    doors.emit('unlinkDir', late);
    expect(watcherOf(late).closed).toBe(true);
    stop();
    expect(watchers.every((w) => w.closed)).toBe(true);
  });

  it('with the real chokidar, sees a worktree born under .kj/worktrees after it started', async () => {
    mkdirSync(lane('.kj', 'worktrees'), { recursive: true });
    const stop = watchLanes(proj, (ev) => sent.push(ev), { project: 'demo', warn: () => {} });
    await new Promise((r) => setTimeout(r, 300));
    const late = lane('.kj', 'worktrees', 'late');
    const file = join(harness(late), 'denials.jsonl');
    await new Promise((r) => setTimeout(r, 500));
    appendFileSync(file, line({ at: 't9', tool: 'Bash', why: 'no' }));
    for (let i = 0; i < 40 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(sent.map((e) => [e.type, e.lane])).toEqual([['sentinel-deny', 'late']]);
  });
});
