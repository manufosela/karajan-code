// KJC-TSK-1399 (ADR 0047): each real event is a box that rides the line to its station.
import { describe, expect, it } from 'vitest';

import { CUE_MS, createDirector } from '../public/stage/director.js';
import { LIFETIME_MS, TRAVEL_MS, boxAt } from '../public/stage/line.js';
import { LINE, STATION_X, STATIONS } from '../public/stage/layout.js';
import { restState, withEvent } from '../public/stage/rest.js';

const cue = { piece: 'review', tone: 'refuse', at: 1000, count: 1 };
const reviewX = STATION_X[STATIONS.indexOf('review')];

describe('boxAt', () => {
  it('enters at the start of the line and is not there before its event', () => {
    expect(boxAt(cue, 999)).toBeNull();
    expect(boxAt(cue, 1000)).toMatchObject({ x: LINE.from, arrived: false, flash: 0 });
  });

  it('rides toward its station, then stops there and flashes', () => {
    const riding = boxAt(cue, 1000 + TRAVEL_MS / 2);
    expect(riding.x).toBeGreaterThan(LINE.from);
    expect(riding.x).toBeLessThan(reviewX);
    const flashing = boxAt(cue, 1000 + TRAVEL_MS + CUE_MS / 2);
    expect(flashing).toMatchObject({ x: reviewX, arrived: true });
    expect(flashing.flash).toBeCloseTo(1);
  });

  it('is gone once its flash is over', () => {
    expect(boxAt(cue, 1000 + LIFETIME_MS)).toBeNull();
  });
});

describe('the director keeps a cue while its box is on the line', () => {
  it('folds a burst into one cue but keeps it alive for the whole ride', () => {
    const director = createDirector({ lifetime: LIFETIME_MS });
    for (let i = 0; i < 50; i++) director.push({ type: 'sentinel-deny', tool: 'Bash' }, 1000 + i * 10);
    expect(director.active(1500)).toEqual([expect.objectContaining({ piece: 'sentinel', count: 50 })]);
    expect(director.active(1000 + LIFETIME_MS - 1)).toHaveLength(1);
    expect(director.active(1000 + LIFETIME_MS)).toHaveLength(0);
  });
});

describe('withEvent', () => {
  it('moves the last real state of the piece an event touches', () => {
    const at = '2026-11-05T08:00:00Z';
    let state = { denial: null, verdict: null, seal: null };
    state = withEvent(state, { type: 'review-verdict', verdict: 'rejected', reviewer: 'codex', at });
    state = withEvent(state, { type: 'sentinel-deny', tool: 'Edit', why: 'x', at });
    state = withEvent(state, { type: 'ledger-seal', decision: 'allow', chokepoint: 'commit', at });
    state = withEvent(state, { type: 'commit-gate', outcome: 'refuse', rule: 'header', at });
    state = withEvent(state, { type: 'unknown', at });
    const { lights, lines } = restState(state, Date.parse(at));
    expect(lines).toEqual([
      'Sentinel: last denial just now (Edit)',
      'Review: rejected by codex, just now',
      'Ledger: allow at commit, just now',
      'Git gates: commit refused (header), just now',
    ]);
    expect(lights.gates).toEqual({ gold: 0, red: 0.35 });
  });

  it('tells who is at work, as agents start and end (KJC-TSK-1430)', () => {
    const act = (agent, role, phase) => ({ type: 'agent-activity', agent, role, phase, at: 'x' });
    let state = withEvent({}, act('codex', 'reviewer', 'start'));
    state = withEvent(state, act('claude', 'coder', 'start'));
    expect(restState(state, 0).lines).toEqual(['At work: codex reviewing, claude coding']);
    state = withEvent(state, act('codex', 'reviewer', 'end'));
    expect(restState(state, 0).lines).toEqual(['At work: claude coding']);
  });

  it('a passed commit opens the Git gates station', () => {
    const state = withEvent({}, { type: 'commit-gate', outcome: 'pass', rule: 'ok', at: '2026-11-05T08:00:00Z' });
    const { lights, lines } = restState(state, Date.parse('2026-11-05T08:03:00Z'));
    expect(lights.gates).toEqual({ gold: 1, red: 0 });
    expect(lines).toEqual(['Git gates: commit passed, 3 min ago']);
  });
});
