// KJC-TSK-1398 (ADR 0046): on open, each piece shows its last real state.
import { describe, expect, it } from 'vitest';

import { restState } from '../public/stage/rest.js';

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
