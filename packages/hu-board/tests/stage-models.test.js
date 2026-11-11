// KJC-TSK-1536 (decided by the maintainer on 2026-11-11): the model and effort an agent runs with, told.
import { describe, expect, it } from 'vitest';

import { familyOf, launchedLabel, modelLabel } from '../public/stage/models.js';
import { restState, withEvent } from '../public/stage/rest.js';

describe('models', () => {
  it('knows the families it dresses, and none for the rest', () => {
    expect(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gpt-5', null].map(familyOf))
      .toEqual(['fable', 'opus', 'sonnet', 'haiku', null, null]);
  });

  it('shortens a model id, and leaves one it does not know as it is', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('sonnet')).toBe('Sonnet');
    expect(modelLabel('gpt-5')).toBe('gpt-5');
    expect(launchedLabel({ model: 'claude-sonnet-5-5', effort: 'medium' })).toBe('(Sonnet 5.5, medium)');
    expect(launchedLabel({})).toBe('');
  });

  it('a live start keeps them, and the status list says them', () => {
    const state = withEvent({}, { type: 'agent-activity', agent: 'claude', role: 'coder', phase: 'start', at: '2026-11-11T10:00:00Z', model: 'claude-opus-5-5', effort: 'high' });
    expect(state.working[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
    expect(restState(state, Date.parse('2026-11-11T10:00:10Z')).lines).toEqual(['At work: claude coding (Opus 5.5, high)']);
  });
});
