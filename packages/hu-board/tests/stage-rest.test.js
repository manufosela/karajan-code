// KJC-TSK-1398 (ADR 0046): on open, each piece shows its last real state.
import { describe, expect, it } from 'vitest';

import { acrossLanes, restState, withEvent } from '../public/stage/rest.js';

const NOW = Date.parse('2026-11-03T10:00:00Z');

describe('restState', () => {
  it('leaves every piece at rest in a project without records', () => {
    expect(restState({ denial: null, verdict: null, seal: null }, NOW)).toEqual({ lights: {}, lines: [] });
  });

  it('lights review and Ledger by their outcome and the Sentinel by its last denial', () => {
    const { lights, lines } = restState({
      denial: { at: '2026-11-03T09:58:00Z', tool: 'Bash', why: 'no' },
      verdict: { verdict: 'rejected', reviewer: 'agy', at: '2026-11-03T09:00:00Z' },
      seal: { decision: 'allow', chokepoint: 'commit', at: '2026-11-03T09:59:30Z' },
    }, NOW);
    expect(lights).toEqual({ sentinel: { gold: 0, red: 0.35 }, review: { gold: 0, red: 0.35 }, ledger: { gold: 1, red: 0 } });
    expect(lines).toEqual([
      'Sentinel: last denial 2 min ago (Bash)',
      'Review: rejected by agy, 60 min ago',
      'Ledger: allow at commit, just now',
    ]);
  });

  it('an old denial no longer lights the Sentinel, but is still told', () => {
    const { lights, lines } = restState({ denial: { at: '2026-11-03T08:00:00Z', tool: 'Edit' }, verdict: null, seal: null }, NOW);
    expect(lights).toEqual({});
    expect(lines).toEqual(['Sentinel: last denial 120 min ago (Edit)']);
  });
});

describe('acrossLanes (ADR 0048)', () => {
  const empty = { denial: null, verdict: null, seal: null, gate: null, working: [] };
  it('keeps the newest record of every lane and everyone at work with their lane', () => {
    const state = acrossLanes([
      { ...empty, lane: 'main', denial: { at: '2026-11-03T09:00:00Z', tool: 'Edit' } },
      { ...empty, lane: 'kj-stage', denial: { at: '2026-11-03T09:30:00Z', tool: 'Bash' }, working: [{ agent: 'codex', role: 'reviewer', at: 'x' }] },
    ]);
    expect(state.denial.tool).toBe('Bash');
    expect(state.verdict).toBeNull();
    expect(restState(state, NOW).lines).toEqual(['Sentinel: last denial 30 min ago (Bash)','At work: codex reviewing in kj-stage']);
  });

  it('tells the host with the tool it uses and each subagent by its id and type (KJC-TSK-1435)', () => {
    const ev = (role, phase, id, extra) => ({ type: 'agent-activity', agent: 'claude', role, phase, id, lane: 'kj-stage', at: 'x', ...extra });
    let state = withEvent({ working: [] }, ev('host', 'start', 's1', { tool: 'Bash' }));
    state = withEvent(state, ev('subagent', 'start', 'a1', { kind: 'Explore' }));
    state = withEvent(state, ev('subagent', 'start', 'a2', { kind: 'Plan' }));
    state = withEvent(state, ev('subagent', 'end', 'a1'));
    expect(restState(state, NOW).lines).toEqual(['At work: claude working (Bash) in kj-stage, claude subagent Plan in kj-stage']);
  });

  it('a live start and end only touch the robot of their own lane', () => {
    const at = (lane, phase) => ({ type: 'agent-activity', agent: 'codex', role: 'reviewer', phase, lane, at: 'x' });
    let state = withEvent(withEvent({ working: [] }, at('a', 'start')), at('b', 'start'));
    state = withEvent(state, at('a', 'end'));
    expect(state.working.map((w) => w.lane)).toEqual(['b']);
  });
});
