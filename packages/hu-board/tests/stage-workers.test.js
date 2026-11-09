// KJC-TSK-1430 (decided by the maintainer on 2026-11-05): each agent kj launches
// is a robot of its own that walks in, works behind its station and walks out.
import { describe, expect, it } from 'vitest';

import { DOOR, KEY_MS, TURN_MS, WALK_MS, accentOf, labelOf, spotOf, turnAt, typingAt, visitKey, withActivity, workerAt, workersFrom } from '../public/stage/workers.js';
import { WORKSHOP } from '../public/stage/layout.js';

const start = (agent, role, lane) => ({ type: 'agent-activity', agent, role, phase: 'start', lane });
const end = (agent, role, lane) => ({ type: 'agent-activity', agent, role, phase: 'end', outcome: 'ok', lane });

describe('turnAt (KJC-TSK-1428)', () => {
  it('turns one page per skill, naming the skill on its page, then rests', () => {
    const turn = { at: 1000, skills: ['tdd', 'review-rules'] };
    expect(turnAt(turn, 1000 + TURN_MS / 2)).toEqual({ page: 1, fraction: 0.5, skill: 'tdd' });
    expect(turnAt(turn, 1000 + TURN_MS * 1.25)).toMatchObject({ page: 2, skill: 'review-rules' });
    expect(turnAt(turn, 1000 + TURN_MS * 2)).toBeNull();
    expect(turnAt(null, 0)).toBeNull();
  });
});

describe('spotOf (ADR 0048)', () => {
  it('puts the coder, the reviewer and Solomon side by side at the bench of their lane', () => {
    const xs = ['coder', 'reviewer', 'solomon'].map((role) => spotOf(role, 10).x);
    expect(new Set(xs).size).toBe(3);
    for (const x of xs) expect(Math.abs(x - 10)).toBeLessThan(WORKSHOP.width / 2);
    expect(spotOf('someone', 10).x).toBe(10);
  });

  it('sends each agent to the workshop of its own lane', () => {
    const xOf = (lane) => ({ main: -5, 'kj-stage': 5 })[lane];
    const [w] = withActivity([], start('codex', 'reviewer', 'kj-stage'), 0);
    expect(workerAt(w, WALK_MS, xOf)).toMatchObject({ ...spotOf('reviewer', 5), walking: false });
    const [m] = withActivity([], start('codex', 'reviewer'), 0);
    expect(m.lane).toBe('main');
  });

  it('keeps one robot per agent and role in each lane', () => {
    let workers = withActivity([], start('codex', 'reviewer', 'a'), 0);
    workers = withActivity(workers, start('codex', 'reviewer', 'b'), 1);
    workers = withActivity(workers, end('codex', 'reviewer', 'a'), 2);
    expect(workers.map((w) => [w.lane, w.leftAt])).toEqual([['a', 2], ['b', undefined]]);
  });
});

describe('the host and its subagents (KJC-TSK-1435)', () => {
  const host = (phase, tool) => ({ type: 'agent-activity', agent: 'claude', role: 'host', phase, lane: 'kj-stage', id: 's1', tool });
  const sub = (phase, id, kind = 'Explore') => ({ type: 'agent-activity', agent: 'claude', role: 'subagent', phase, lane: 'kj-stage', id, kind });
  const xOf = () => 10;

  it('the host works at its bench, its beat only changes the tool it says, and its label says it', () => {
    let workers = withActivity([], host('start', 'Bash'), 0);
    workers = withActivity(workers, host('start', 'Edit'), 60_000);
    expect(workers).toHaveLength(1);
    expect(labelOf(workers[0])).toBe('claude · Edit');
    expect(workerAt(workers[0], WALK_MS, xOf)).toMatchObject({ ...spotOf('host', 10), walking: false });
  });

  it('a host whose session has a name says it instead of its agent (KJC-TSK-1483)', () => {
    const [worker] = withActivity([], { ...host('start', 'Bash'), name: 'kj-stage' }, 0);
    expect(labelOf(worker)).toBe('kj-stage · Bash');
    expect(labelOf({ ...worker, tool: null })).toBe('kj-stage');
  });

  it('each subagent walks out of the host to its own slot before the bench, and back into it', () => {
    let workers = withActivity([], host('start', 'Agent'), 0);
    workers = withActivity(workers, sub('start', 'a1'), 100);
    workers = withActivity(workers, sub('start', 'a2', 'Plan'), 100);
    const [, a1, a2] = workers;
    expect([a1.slot, a2.slot]).toEqual([0, 1]);
    expect([labelOf(a1), labelOf(a2)]).toEqual(['Explore', 'Plan']);
    expect(workerAt(a1, 100, xOf)).toMatchObject({ ...spotOf('host', 10), walking: true });
    expect(workerAt(a1, 100 + WALK_MS, xOf)).toMatchObject({ ...spotOf('subagent', 10, 0), walking: false });
    workers = withActivity(workers, sub('end', 'a1'), 5000);
    expect(workerAt(workers[1], 5000 + WALK_MS / 2, xOf).walking).toBe(true);
    expect(workerAt(workers[1], 5000 + WALK_MS, xOf)).toBeNull();
    expect(workers[2].leftAt).toBeUndefined();
    // the freed slot is the next subagent's
    workers = withActivity(workers, sub('start', 'a3'), 6000);
    expect(workers.at(-1).slot).toBe(0);
  });

  it('never puts two subagents on one spot: past a row of five they start another', () => {
    const spots = Array.from({ length: 12 }, (_, slot) => spotOf('subagent', 0, slot)).map(({ x, z }) => `${x},${z}`);
    expect(new Set(spots).size).toBe(12);
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
    const [w] = workersFrom([{ agent: 'agy', role: 'solomon', at: 'x' }], 5000, 'kj-stage');
    expect(w.lane).toBe('kj-stage');
    expect(workerAt(w, 5000, () => 3)).toMatchObject({ ...spotOf('solomon', 3), walking: false });
  });
});

describe('typingAt (KJC-TSK-1486)', () => {
  it('holds both hands over the keyboard, one striking while the other rises', () => {
    const struck = typingAt(KEY_MS / 2);
    expect(struck.L).toBeGreaterThan(struck.R);
    const other = typingAt(KEY_MS * 1.5);
    expect(other.R).toBeGreaterThan(other.L);
  });

  it('never drops a hand from the keyboard nor lifts it past it', () => {
    for (let t = 0; t < KEY_MS * 4; t += 37) {
      for (const hand of Object.values(typingAt(t))) {
        expect(hand).toBeGreaterThanOrEqual(1);
        expect(hand).toBeLessThanOrEqual(1.25);
      }
    }
  });
});
