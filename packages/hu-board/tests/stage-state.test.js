// KJC-TSK-1405 (ADR 0046): on open, each stage piece shows its last real state.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  prev = { home: process.env.KJ_HOME, plans: process.env.KJ_PLANS_DIR };
  process.env.KJ_HOME = join(tmp, 'home');
  process.env.KJ_PLANS_DIR = join(tmp, 'plans');
});

afterEach(() => {
  for (const [k, v] of [['KJ_HOME', prev.home], ['KJ_PLANS_DIR', prev.plans]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('lastStageState', () => {
  it('is all null in a project without records', () => {
    expect(lastStageState(proj)).toEqual({ denial: null, verdict: null, seal: null, gate: null, working: [], cards: [], mail: 0 });
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
  });

  it('takes the last commit attempt the commit-msg guard traced (KJC-TSK-1427)', () => {
    writeFileSync(kj('harness', 'commit-gate.jsonl'), jsonl({ at: 'c1', outcome: 'pass', rule: 'ok' }, { at: 'c2', outcome: 'refuse', rule: 'header' }));
    expect(lastStageState(proj).gate).toEqual({ type: 'commit-gate', at: 'c2', outcome: 'refuse', rule: 'header' });
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
  it('answers the state of the project it names, and 400 without one it can resolve', async () => {
    const { deriveProjectIdFromDir } = await import('../src/sync.js');
    const slug = deriveProjectIdFromDir(proj);
    mkdirSync(join(tmp, 'plans', slug), { recursive: true });
    writeFileSync(join(tmp, 'plans', slug, 'plan-1.json'), JSON.stringify({ projectDir: proj }));
    const { default: apiRoutes } = await import('../src/routes/api.js');
    const app = express().use('/api', apiRoutes);
    const ok = await request(app).get(`/api/stage/state?project=${slug}`).expect(200);
    const empty = { denial: null, verdict: null, seal: null, gate: null, working: [], cards: [], mail: 0 };
    expect(ok.body).toEqual({ ...empty, lanes: [{ lane: 'main', ...empty }] });
    await request(app).get('/api/stage/state?project=nowhere').expect(400);
    await request(app).get('/api/stage/state').expect(400);
  });
});
