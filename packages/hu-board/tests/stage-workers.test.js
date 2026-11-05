// KJC-TSK-1430 (decided by the maintainer on 2026-11-05): each agent kj launches
// is a robot of its own that walks in, works behind its station and walks out.
import { describe, expect, it } from 'vitest';

import { DOOR, TURN_MS, WALK_MS, accentOf, spotOf, turnAt, visitKey, withActivity, workerAt, workersFrom } from '../public/stage/workers.js';
import { STATION_X, STATIONS } from '../public/stage/layout.js';

const start = (agent, role) => ({ type: 'agent-activity', agent, role, phase: 'start' });
const end = (agent, role) => ({ type: 'agent-activity', agent, role, phase: 'end', outcome: 'ok' });

describe('turnAt (KJC-TSK-1428)', () => {
  it('turns one page per skill, naming the skill on its page, then rests', () => {
    const turn = { at: 1000, skills: ['tdd', 'review-rules'] };
    expect(turnAt(turn, 1000 + TURN_MS / 2)).toEqual({ page: 1, fraction: 0.5, skill: 'tdd' });
    expect(turnAt(turn, 1000 + TURN_MS * 1.25)).toMatchObject({ page: 2, skill: 'review-rules' });
    expect(turnAt(turn, 1000 + TURN_MS * 2)).toBeNull();
    expect(turnAt(null, 0)).toBeNull();
  });
});

describe('spotOf', () => {
  it('puts the coder behind TDD and the reviewer and Solomon behind AI review, side by side', () => {
    expect(spotOf('coder').x).toBe(STATION_X[STATIONS.indexOf('tdd')]);
    expect(spotOf('reviewer').x).toBe(STATION_X[STATIONS.indexOf('review')]);
    expect(spotOf('solomon').x).not.toBe(spotOf('reviewer').x);
  });
});

describe('a worker over time', () => {
  it('walks in from the door, works at its spot, then walks out and is gone', () => {
    let workers = withActivity([], start('codex', 'reviewer'), 1000);
    const [codex] = workers;
    expect(workerAt(codex, 1000)).toMatchObject({ x: DOOR.x, z: DOOR.z, walking: true });
    expect(workerAt(codex, 1000 + WALK_MS)).toMatchObject({ ...spotOf('reviewer'), walking: false });
    workers = withActivity(workers, end('codex', 'reviewer'), 9000);
    expect(workerAt(workers[0], 9000 + WALK_MS / 2).walking).toBe(true);
    expect(workerAt(workers[0], 9000 + WALK_MS)).toBeNull();
  });

  it('a departure at time 0 is a departure: a new start brings a new robot', () => {
    let workers = withActivity([], start('codex', 'reviewer'), -100);
    workers = withActivity(workers, end('codex', 'reviewer'), 0);
    workers = withActivity(workers, start('codex', 'reviewer'), 10);
    workers = withActivity(workers, end('codex', 'reviewer'), 20);
    expect(workers.map((w) => w.leftAt)).toEqual([0, 20]);
  });

  it('keeps one robot per agent and role, and ignores other events', () => {
    let workers = withActivity([], start('claude', 'coder'), 0);
    workers = withActivity(workers, start('claude', 'coder'), 10);
    workers = withActivity(workers, { type: 'sentinel-deny' }, 20);
    expect(workers).toHaveLength(1);
  });

  it('gives each agent its own colour and keeps one key for its whole visit', () => {
    expect(accentOf('claude')).not.toBe(accentOf('codex'));
    expect(accentOf('someone-new')).toBe(accentOf('another-new'));
    const [entering] = withActivity([], start('codex', 'reviewer'), 1000);
    const [leaving] = withActivity([entering], end('codex', 'reviewer'), 2000);
    expect(visitKey(leaving)).toBe(visitKey(entering));
  });

  it('agents already at work when the stage opens stand at their spot', () => {
    const [w] = workersFrom([{ agent: 'agy', role: 'solomon', at: 'x' }], 5000);
    expect(workerAt(w, 5000)).toMatchObject({ ...spotOf('solomon'), walking: false });
  });
});
