// KJC-TSK-1398 (ADR 0046): on open, each piece shows its last real state.
import { describe, expect, it } from 'vitest';

import { acrossLanes, restState, withEvent } from '../public/stage/rest.js';

const NOW = Date.parse('2026-11-03T10:00:00Z');

describe('restState', () => {
  it('leaves every piece at rest in a project without records', () => {
    expect(restState({ denial: null, verdict: null, seal: null }, NOW)).toEqual({ lights: {}, lines: [], ordered: [] });
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

  // KJC-TSK-1524: kj review's last check of TDD, Sonar and the Steward lights each and is told.
  it('lights and tells the last check of TDD, Sonar and the Steward', () => {
    let state = withEvent({}, { type: 'method-check', piece: 'tdd', outcome: 'pass', at: '2026-11-03T09:59:30Z' });
    state = withEvent(state, { type: 'method-check', piece: 'sonar', outcome: 'refuse', at: '2026-11-03T09:59:40Z' });
    const { lights, lines } = restState(state, NOW);
    expect(lights).toEqual({ tdd: { gold: 1, red: 0 }, sonar: { gold: 0, red: 0.35 } });
    expect(lines).toEqual(['TDD: passed, just now', 'SonarQube: refused, just now']);
  });

  it('opens with each check at its newest across lanes (KJC-TSK-1524)', () => {
    const { checks } = acrossLanes([
      { lane: 'main', checks: { tdd: { outcome: 'refuse', at: '2026-11-03T09:00:00Z' } } },
      { lane: 'feat-x', checks: { tdd: { outcome: 'pass', at: '2026-11-03T09:30:00Z' }, steward: { outcome: 'pass', at: '2026-11-03T09:10:00Z' } } },
    ]);
    expect(checks).toEqual({ tdd: { outcome: 'pass', at: '2026-11-03T09:30:00Z' }, steward: { outcome: 'pass', at: '2026-11-03T09:10:00Z' } });
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

  // KJC-TSK-1458 (ADR 0050): one board for the factory, from every lane, live too.
  it('merges the cards of every lane, moves them live and tells the board', () => {
    const state = acrossLanes([
      { ...empty, lane: 'main', cards: [{ id: 'HU-1', title: 'Login', status: 'pending', lane: 'main', at: '2026-11-03T09:00:00Z' }] },
      { ...empty, lane: 'kj-stage', cards: [{ id: 'HU-2', title: 'Logout', status: 'pending', lane: 'kj-stage', at: '2026-11-03T09:10:00Z' }] },
    ]);
    const moved = withEvent(state, { type: 'card', action: 'move', id: 'HU-1', title: null, status: 'running', lane: 'kj-stage', at: '2026-11-03T09:20:00Z', queued: false });
    expect(moved.cards.map((c) => [c.id, c.status, c.lane])).toEqual([['HU-2', 'pending', 'kj-stage'], ['HU-1', 'running', 'kj-stage']]);
    expect(restState(moved, NOW).lines).toEqual(['Board: 1 to do, 1 in progress, 0 done']);
  });

  it('a live start and end only touch the robot of their own lane', () => {
    const at = (lane, phase) => ({ type: 'agent-activity', agent: 'codex', role: 'reviewer', phase, lane, at: 'x' });
    let state = withEvent(withEvent({ working: [] }, at('a', 'start')), at('b', 'start'));
    state = withEvent(state, at('a', 'end'));
    expect(state.working.map((w) => w.lane)).toEqual(['b']);
  });
});
