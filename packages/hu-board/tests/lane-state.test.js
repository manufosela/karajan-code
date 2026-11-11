import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveLaneState } from '../src/lane-state.js';
import { laneStates } from '../src/stage-state.js';

const at = { agent: 'claude', role: 'host', at: '2026-01-01T00:00:00Z' };
const running = [{ id: 'HU-1', status: 'running' }];
// Every fact readable and quiet; each case overrides what it tests.
const quiet = { working: [], cards: running, mail: 0, openPr: false, merged: false };
const state = (facts) => deriveLaneState({ ...quiet, ...facts });

describe('deriveLaneState', () => {
  it.each([
    ['working', { working: [at] }],
    ['waiting-merge', { openPr: true }],
    ['waiting-person', { mail: 2 }],
    ['idle', {}],
    ['finished', { cards: [{ id: 'HU-1', status: 'done' }] }],
    ['finished', { merged: true }],
  ])('%s', (expected, facts) => {
    const result = state(facts);
    expect(result.state).toBe(expected);
    expect(result.stateReason).toEqual(expect.any(String));
    expect(result.stateReason).not.toBe('');
  });

  it('does not take a lane without cards for finished', () => {
    expect(state({ cards: [] }).state).toBe('idle');
  });

  it('keeps a lane with one card still running unfinished', () => {
    const cards = [{ id: 'HU-1', status: 'done' }, { id: 'HU-2', status: 'running' }];
    expect(state({ cards }).state).toBe('idle');
  });

  describe('precedence: finished > waiting-merge > waiting-person > working > idle', () => {
    it('finished beats everything', () => {
      expect(state({ merged: true, openPr: true, mail: 1, working: [at] }).state).toBe('finished');
    });
    it('a pending handoff beats activity', () => {
      expect(state({ mail: 1, working: [at] }).state).toBe('waiting-person');
    });
    it('an open pull request with activity is still working', () => {
      expect(state({ openPr: true, working: [at] }).state).toBe('working');
    });
    it('an open pull request beats a pending handoff', () => {
      expect(state({ openPr: true, mail: 1 }).state).toBe('waiting-merge');
    });
  });

  describe('a fact that cannot be read is never working', () => {
    it.each(['working', 'cards', 'mail', 'openPr', 'merged'])('%s unreadable', (fact) => {
      expect(state({ [fact]: null, working: fact === 'working' ? null : [at] }).state).toBe('unknown');
    });
    it('a missing fact is unreadable too', () => {
      expect(deriveLaneState({ working: [at] }).state).toBe('unknown');
    });
    it('a readable higher state still wins over an unreadable lower fact', () => {
      expect(state({ merged: true, mail: null }).state).toBe('finished');
      expect(state({ openPr: true, mail: null }).state).toBe('waiting-merge');
    });
    it('names what it could not read', () => {
      expect(state({ openPr: null }).stateReason).toMatch(/openPr/);
    });
  });
});

describe('laneStates carries the state', () => {
  let proj;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'lane-state-'));
    mkdirSync(join(proj, '.kj', 'worktrees', 'w1'), { recursive: true });
    writeFileSync(join(proj, '.kj', 'worktrees', 'w1', '.git'), 'gitdir: ../../.git/worktrees/w1\n');
  });
  afterEach(() => rmSync(proj, { recursive: true, force: true }));

  it('adds state and stateReason to every lane, unknown while the readers are missing', () => {
    const lanes = laneStates(proj);
    expect(lanes.map((l) => l.lane)).toEqual(['main', 'w1']);
    for (const l of lanes) {
      expect(l.state).toBe('unknown');
      expect(l.stateReason).toMatch(/merged/);
    }
  });

  it('uses the injected readers, per lane, and a throwing reader reads as unknown', () => {
    const readers = { openPr: ({ lane }) => lane === 'w1', merged: () => false };
    const byLane = Object.fromEntries(laneStates(proj, { readers }).map((l) => [l.lane, l.state]));
    expect(byLane).toEqual({ main: 'idle', w1: 'waiting-merge' });
    const broken = { openPr: () => { throw new Error('offline'); }, merged: () => false };
    expect(laneStates(proj, { readers: broken })[1].state).toBe('unknown');
  });
});
