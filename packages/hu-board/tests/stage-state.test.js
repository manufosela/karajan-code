// KJC-TSK-1405 (ADR 0046): on open, each stage piece shows its last real state.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import express from 'express';
import request from 'supertest';

import { lastStageState } from '../src/stage-state.js';

let tmp, proj, prev;
const kj = (...p) => join(proj, '.karajan', ...p);
const jsonl = (...rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hu-board-stage-state-'));
  proj = join(tmp, 'work', 'proj');
  mkdirSync(kj('harness'), { recursive: true });
  mkdirSync(kj('reviews'), { recursive: true });
  prev = { home: process.env.KJ_HOME, plans: process.env.KJ_PLANS_DIR, path: process.env.PATH };
  process.env.KJ_HOME = join(tmp, 'home');
  process.env.KJ_PLANS_DIR = join(tmp, 'plans');
});

afterEach(() => {
  for (const [k, v] of [['KJ_HOME', prev.home], ['KJ_PLANS_DIR', prev.plans], ['PATH', prev.path]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('lastStageState', () => {
  it('is all null in a project without records', () => {
    expect(lastStageState(proj)).toEqual({ denial: null, verdict: null, seal: null, gate: null, checks: {}, working: [], cards: [], mail: 0 });
  });

  // KJC-TSK-1458 (ADR 0050): the factory's board opens on the last line of each card, in its lane.
  it('folds the card trace into the last state of each card, with its lane', () => {
    writeFileSync(kj('harness', 'cards.jsonl'), jsonl(
      { at: '2026-11-08T10:00:00Z', action: 'add', id: 'HU-1', title: 'Login', status: 'pending' },
      { at: '2026-11-08T10:01:00Z', action: 'add', id: 'HU-2', title: 'Logout', status: 'pending' },
      { at: '2026-11-08T10:02:00Z', action: 'move', id: 'HU-1', status: 'running' },
      { at: '2026-11-08T10:03:00Z', action: 'move', id: 'HU-2', status: 'done', queued: true },
    ));
    expect(lastStageState(proj, { lane: 'feat-x' }).cards).toEqual([
      { id: 'HU-2', title: 'Logout', status: 'pending', lane: 'feat-x', at: '2026-11-08T10:01:00Z' },
      { id: 'HU-1', title: 'Login', status: 'running', lane: 'feat-x', at: '2026-11-08T10:02:00Z' },
    ]);
  });

  // KJC-TSK-1536: an agent at work opens with the model and effort its start named.
  it('keeps the model and effort of an agent still at work', () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(kj('harness', 'agent-activity.jsonl'), jsonl({ at, agent: 'claude', role: 'coder', phase: 'start', model: 'claude-sonnet-5-5', effort: 'low' }));
    expect(lastStageState(proj).working).toEqual([{ agent: 'claude', role: 'coder', at, model: 'claude-sonnet-5-5', effort: 'low' }]);
  });

  // KJC-TSK-1524: the stage opens with kj review's last check of each piece.
  it('keeps the last check of each of TDD, Sonar and the Steward', () => {
    writeFileSync(kj('harness', 'method.jsonl'), jsonl(
      { at: '2026-11-08T10:00:00Z', piece: 'tdd', outcome: 'refuse' },
      { at: '2026-11-08T10:01:00Z', piece: 'sonar', outcome: 'pass' },
      { at: '2026-11-08T10:02:00Z', piece: 'tdd', outcome: 'pass' },
    ));
    expect(lastStageState(proj).checks).toEqual({ tdd: { outcome: 'pass', at: '2026-11-08T10:02:00Z' }, sonar: { outcome: 'pass', at: '2026-11-08T10:01:00Z' } });
  });

  // KJC-BUG-0546: kj hu writes a lane's card lines in the main checkout, naming the lane.
  it('a card line that names its lane keeps it', () => {
    writeFileSync(kj('harness', 'cards.jsonl'), jsonl(
      { at: '2026-11-08T10:00:00Z', action: 'move', id: 'HU-1', status: 'running' },
      { at: '2026-11-08T10:05:00Z', action: 'move', id: 'HU-1', status: 'done', lane: 'feat-x' },
    ));
    expect(lastStageState(proj).cards).toEqual([{ id: 'HU-1', title: null, status: 'done', lane: 'feat-x', at: '2026-11-08T10:05:00Z' }]);
  });

  it('names the agents still at work: a recent start with no end (KJC-TSK-1430)', () => {
    const now = Date.parse('2026-11-05T10:00:00Z');
    writeFileSync(kj('harness', 'agent-activity.jsonl'), jsonl(
      { at: '2026-11-05T09:58:00Z', agent: 'codex', role: 'reviewer', phase: 'start' },
      { at: '2026-11-05T09:59:00Z', agent: 'codex', role: 'reviewer', phase: 'end', outcome: 'ok' },
      { at: '2026-11-05T09:59:30Z', agent: 'claude', role: 'coder', phase: 'start' },
      { at: '2026-11-05T08:00:00Z', agent: 'agy', role: 'solomon', phase: 'start' },
    ));
    expect(lastStageState(proj, { now }).working).toEqual([{ agent: 'claude', role: 'coder', at: '2026-11-05T09:59:30Z' }]);
  });

  it('tells the host and each subagent apart by id, and a host silent for 5 min has stopped (KJC-TSK-1435)', () => {
    const now = Date.parse('2026-11-05T10:00:00Z');
    writeFileSync(kj('harness', 'agent-activity.jsonl'), jsonl(
      { at: '2026-11-05T09:59:00Z', agent: 'claude', role: 'host', phase: 'start', id: 's1', tool: 'Bash' },
      { at: '2026-11-05T09:50:00Z', agent: 'claude', role: 'host', phase: 'start', id: 's0', tool: 'Read' },
      { at: '2026-11-05T09:59:10Z', agent: 'claude', role: 'subagent', phase: 'start', id: 'a1', kind: 'Explore' },
      { at: '2026-11-05T09:59:20Z', agent: 'claude', role: 'subagent', phase: 'start', id: 'a2', kind: 'Plan' },
    ));
    expect(lastStageState(proj, { now }).working.map((w) => [w.role, w.id, w.tool ?? w.kind])).toEqual([
      ['host', 's1', 'Bash'], ['subagent', 'a1', 'Explore'], ['subagent', 'a2', 'Plan'],
    ]);
    // KJC-TSK-1483: the host carries its session's name.
    const nameOf = (id) => (id === 's1' ? 'kj-stage' : null);
    expect(lastStageState(proj, { now, nameOf }).working[0]).toMatchObject({ id: 's1', name: 'kj-stage' });
  });

  it('takes the last commit attempt the commit-msg guard traced (KJC-TSK-1427)', () => {
    writeFileSync(kj('harness', 'commit-gate.jsonl'), jsonl({ at: 'c1', outcome: 'pass', rule: 'ok' }, { at: 'c2', outcome: 'refuse', rule: 'header' }));
    expect(lastStageState(proj).gate).toEqual({ type: 'commit-gate', at: 'c2', outcome: 'refuse', rule: 'header' });
  });

  // KJC-BUG-0527: the traces moved to .karajan/traces; hooks sealed earlier still write to harness.
  it('reads the traces from traces/ and merges them with harness/ in time order', () => {
    mkdirSync(kj('traces'), { recursive: true });
    writeFileSync(kj('traces', 'cards.jsonl'), jsonl({ at: '2026-11-08T10:00:00Z', action: 'add', id: 'HU-1', title: 'Login', status: 'pending' }));
    expect(lastStageState(proj).cards).toHaveLength(1);
    writeFileSync(kj('harness', 'cards.jsonl'), jsonl({ at: '2026-11-08T10:05:00Z', action: 'move', id: 'HU-1', status: 'running' }));
    writeFileSync(kj('traces', 'cards.jsonl'), jsonl(
      { at: '2026-11-08T10:00:00Z', action: 'add', id: 'HU-1', title: 'Login', status: 'pending' },
      { at: '2026-11-08T10:09:00Z', action: 'move', id: 'HU-1', status: 'done' },
    ));
    expect(lastStageState(proj).cards.map((c) => [c.id, c.status])).toEqual([['HU-1', 'done']]);
  });

  it('takes the newer gate whichever folder holds it', () => {
    mkdirSync(kj('traces'), { recursive: true });
    writeFileSync(kj('harness', 'commit-gate.jsonl'), jsonl({ at: '2026-11-08T10:00:00Z', outcome: 'pass', rule: 'old' }));
    writeFileSync(kj('traces', 'commit-gate.jsonl'), jsonl({ at: '2026-11-08T11:00:00Z', outcome: 'refuse', rule: 'new' }));
    expect(lastStageState(proj).gate.rule).toBe('new');
  });

  it('takes the last denial and seal and the newest verdict', () => {
    writeFileSync(kj('harness', 'denials.jsonl'), jsonl({ at: 't1', tool: 'Bash', why: 'a' }, { at: 't2', tool: 'Edit', why: 'b' }));
    writeFileSync(kj('policy-decisions.jsonl'), jsonl({ ts: 's1', decision: 'allow', chokepoint: 'commit' }));
    writeFileSync(kj('reviews', 'old.json'), JSON.stringify({ verdict: 'approved', diffHash: 'old' }));
    writeFileSync(kj('reviews', 'new.json'), JSON.stringify({ verdict: 'rejected', diffHash: 'new', reviewer: 'agy' }));
    utimesSync(kj('reviews', 'old.json'), new Date(1000), new Date(1000));
    const state = lastStageState(proj);
    expect(state.denial).toMatchObject({ type: 'sentinel-deny', at: 't2', tool: 'Edit' });
    expect(state.seal).toMatchObject({ type: 'ledger-seal', decision: 'allow' });
    expect(state.verdict).toMatchObject({ type: 'review-verdict', verdict: 'rejected', diffHash: 'new' });
  });

  it('reads only the tail of a large log, skipping a cut first line', () => {
    const filler = Array.from({ length: 2000 }, (_, i) => ({ at: `t${i}`, tool: 'Bash', why: 'x'.repeat(40) }));
    writeFileSync(kj('harness', 'denials.jsonl'), jsonl(...filler));
    expect(lastStageState(proj, { tailBytes: 300 }).denial).toMatchObject({ at: 't1999' });
  });
});

describe('GET /api/stage/state', () => {
  /** The board's api, and the slug of the test project it knows. */
  const serve = async () => {
    const { deriveProjectIdFromDir } = await import('../src/sync.js');
    const slug = deriveProjectIdFromDir(proj);
    mkdirSync(join(tmp, 'plans', slug), { recursive: true });
    writeFileSync(join(tmp, 'plans', slug, 'plan-1.json'), JSON.stringify({ projectDir: proj }));
    const { default: apiRoutes } = await import('../src/routes/api.js');
    return { slug, app: express().use('/api', apiRoutes) };
  };

  it('answers the state of the project it names, and 400 without one it can resolve', async () => {
    const { slug, app } = await serve();
    const ok = await request(app).get(`/api/stage/state?project=${slug}`).expect(200);
    const empty = { denial: null, verdict: null, seal: null, gate: null, checks: {}, working: [], cards: [], mail: 0 };
    // KJC-TSK-1525: the main checkout says the last release (none in a project without tags).
    // KJC-TSK-1539: and what the lane is doing.
    const status = { state: 'idle', why: 'no activity' };
    // HU-3853: without readers for the pull request and the merge, the lane's state is unknown.
    const unread = { state: 'unknown', stateReason: 'cannot read merged' };
    // KJC-TSK-1541: the main checkout carries no note.
    // HU-4029: nor a pipeline, there being no pull request to read.
    expect(ok.body).toEqual({ ...empty, ...unread, release: null, status, note: null, pipeline: null, lanes: [{ lane: 'main', ...empty, ...unread, release: null, status, note: null, pipeline: null }] });
    await request(app).get('/api/stage/state?project=nowhere').expect(400);
    await request(app).get('/api/stage/state').expect(400);
  });

  // HU-4029: gh is a network call; while a slow one runs, the board answers everyone else.
  it('reads the pipeline of each lane without holding the server', async () => {
    mkdirSync(join(proj, '.kj', 'worktrees', 'pay'), { recursive: true });
    writeFileSync(join(proj, '.kj', 'worktrees', 'pay', '.git'), 'gitdir: ../../.git/worktrees/pay\n');
    const pr = JSON.stringify({ state: 'OPEN', statusCheckRollup: [{ __typename: 'CheckRun', status: 'IN_PROGRESS' }] });
    mkdirSync(join(tmp, 'bin'));
    writeFileSync(join(tmp, 'bin', 'gh'), `#!/bin/sh\nsleep 1\necho '${pr}'\n`, { mode: 0o755 });
    process.env.PATH = `${join(tmp, 'bin')}${delimiter}${prev.path}`;
    const { slug, app } = await serve();
    app.get('/ping', (_req, res) => res.send('pong'));
    const answered = [];
    const stage = request(app).get(`/api/stage/state?project=${slug}`).then((res) => { answered.push('stage'); return res; });
    await new Promise((r) => setTimeout(r, 200));
    await request(app).get('/ping').expect(200).then(() => answered.push('ping'));
    const { body } = await stage;
    expect(answered).toEqual(['ping', 'stage']);
    expect(body.lanes[1]).toMatchObject({ lane: 'pay', pipeline: 'running', status: { state: 'waiting-merge', why: 'pipeline running' } });
  });
});
