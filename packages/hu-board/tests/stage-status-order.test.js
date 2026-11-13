// KJC-TSK-1608 (the maintainer, 2026-11-13): "the text at the bottom left, is it read bottom up or
// top down? It is confusing." It reads top down: who works now, then what happened from the newest
// down, the newest in Matrix green and bold, each line in the colour of what it says, the board last.
import { describe, expect, it } from 'vitest';

import { restState } from '../public/stage/rest.js';

const NOW = Date.parse('2026-11-13T21:00:00Z');
const state = {
  denial: { at: '2026-11-13T20:10:00Z', tool: 'Bash' },
  verdict: { verdict: 'approved', reviewer: 'agy', at: '2026-11-13T20:55:00Z' },
  seal: { decision: 'exempt', chokepoint: 'commit', at: '2026-11-13T20:30:00Z' },
  gate: { outcome: 'fail', rule: 'header-max-length', at: '2026-11-13T20:50:00Z' },
  checks: { tdd: { outcome: 'pass', at: '2026-11-13T20:40:00Z' } },
  cards: [{ id: 'HU-1', status: 'running', lane: 'main', at: '2026-11-13T20:00:00Z' }],
  working: [{ agent: 'claude', role: 'host', tool: 'Edit', lane: 'main' }],
};

describe('the ordered status', () => {
  const { ordered, lines } = restState(state, NOW);

  it('who works now first, then what happened from the newest down, the board last', () => {
    expect(ordered.map((e) => e.text.split(':')[0])).toEqual(['At work', 'Review', 'Git gates', 'TDD', 'Ledger', 'Sentinel', 'Board']);
  });

  it('only the newest thing that happened is marked newest', () => {
    expect(ordered.filter((e) => e.newest).map((e) => e.text.split(':')[0])).toEqual(['Review']);
  });

  it('each line in the tone of what it says', () => {
    const tone = Object.fromEntries(ordered.map((e) => [e.text.split(':')[0], e.tone]));
    expect(tone).toEqual({ 'At work': 'live', Review: 'pass', 'Git gates': 'refuse', TDD: 'pass', Ledger: 'pass', Sentinel: 'refuse', Board: 'info' });
  });

  it('says the same lines as before, only ordered', () => {
    expect(ordered.map((e) => e.text).toSorted()).toEqual(lines.toSorted());
  });

  it('a host that waits for the person makes its line one that waits', () => {
    const waiting = restState({ working: [{ agent: 'claude', role: 'host', waiting: 'person', lane: 'main' }] }, NOW).ordered;
    expect(waiting[0].tone).toBe('wait');
  });
});
