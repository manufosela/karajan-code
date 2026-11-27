// KJC-TSK-1685 (decided by the maintainer on 2026-11-18): the governance panel as a card on top, in
// big type, each agent in its colour and a stand-in in amber, instead of a tiny line in the status.
import { describe, expect, it } from 'vitest';

import { panelCells } from '../public/stage/governance-card.js';

// KJC-TSK-1814: every agent kj runs has a colour now; one it does not know stays gray.
const panel = { coder: 'claude', reviewer: 'agy', solomon: 'someone-new', substitutions: {} };

describe('panelCells', () => {
  it('gives each role its agent in the colour its robots wear, any other agent gray', () => {
    expect(panelCells(panel)).toEqual([
      { role: 'Coder', agent: 'claude', colour: '#d97757', standIn: null },
      { role: 'Reviewer', agent: 'agy', colour: '#7ee0b5', standIn: null },
      { role: 'Solomon', agent: 'someone-new', colour: '#c0c8d0', standIn: null },
    ]);
  });

  it('shows the agent that stands in, and for whom and why', () => {
    const stood = { ...panel, reviewer: 'codex', substitutions: { reviewer: { declared: 'codex', acting: 'agy', reason: 'quota', since: '2026-11-17T06:00:00Z' } } };
    expect(panelCells(stood)[1]).toEqual({ role: 'Reviewer', agent: 'agy', colour: '#7ee0b5', standIn: 'for codex: no quota' });
  });

  it('has no cells without a panel', () => {
    expect(panelCells(null)).toEqual([]);
  });
});
