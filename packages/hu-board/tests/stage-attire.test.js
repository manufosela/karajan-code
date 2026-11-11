// KJC-TSK-1538 (decided by the maintainer on 2026-11-11): a robot wears its model's accessory and
// is built by its effort: high strong, medium as it is, low slim. The accessories themselves are
// three.js meshes (attire.js), checked in the browser; here, what decides them.
import { describe, expect, it } from 'vitest';

import { buildOf, familyOf } from '../public/stage/models.js';
import { withActivity } from '../public/stage/workers.js';

describe('attire', () => {
  it('builds a robot by its effort, as it is when unknown', () => {
    expect([buildOf('low'), buildOf('medium'), buildOf('high'), buildOf('max'), buildOf(undefined), buildOf('odd')]).toEqual([0.78, 1, 1.25, 1.4, 1, 1]);
  });

  it('dresses only the families it has an accessory for', () => {
    expect(familyOf('claude-fable-5-1')).toBe('fable');
    expect(familyOf('gpt-5')).toBeNull();
  });
});

describe('a worker keeps its model and effort', () => {
  const start = (over) => ({ type: 'agent-activity', agent: 'claude', role: 'host', phase: 'start', lane: 'a', id: 's1', ...over });

  it('from its start, and a later beat with another model changes it', () => {
    let workers = withActivity([], start({ model: 'claude-sonnet-5-5', effort: 'low' }), 0);
    expect(workers[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' });
    workers = withActivity(workers, start({ tool: 'Edit', model: 'claude-opus-5-5' }), 10);
    expect(workers[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'low', tool: 'Edit' });
  });
});
