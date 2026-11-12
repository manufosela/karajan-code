// KJC-TSK-1572 (ADR 0056, point 3): what crosses the room. Out goes only an agent's activity, with
// the fields the ADR names and the own avatar; in comes a teammate's, checked, in its lane@login.
import { describe, expect, it } from 'vitest';

import { createTeamFloor, incoming, outgoing } from '../src/room/bridge.js';

const avatar = { emblem: 'owl', colors: { coder: '#22aa66' } };
const start = { type: 'agent-activity', phase: 'start', agent: 'codex', role: 'coder', lane: 'kj-stage', id: 's1', model: 'gpt-5', effort: 'high', at: '2026-11-12T18:00:00Z', tool: 'Edit' };

describe('outgoing', () => {
  it('sends an agent\'s activity with only the named fields and the own avatar', () => {
    expect(outgoing({ ...start, prompt: 'secret', skills: ['x'], cwd: '/home/manu/w' }, avatar)).toEqual({ ...start, avatar });
  });

  it('sends nothing else: other events, or a lane that is not a slug', () => {
    expect(outgoing({ type: 'sentinel-deny', tool: 'Bash' }, avatar)).toBeNull();
    expect(outgoing({ ...start, lane: '/home/manu/x' }, avatar)).toBeNull();
  });

  it('sends the own avatar cleaned, and none when nothing of it is valid', () => {
    const dirty = { emblem: 'owl', colors: { coder: '#22aa66', pilot: '#000000' }, home: '/home/manu', token: 'x' };
    expect(outgoing(start, dirty).avatar).toEqual({ emblem: 'owl', colors: { coder: '#22aa66' } });
    expect(outgoing(start, { emblem: 'dragon', note: 'x' })).not.toHaveProperty('avatar');
  });

  it('says main for an activity with no lane', () => {
    expect(outgoing({ ...start, lane: undefined }, null).lane).toBe('main');
  });
});

describe('incoming', () => {
  it('takes a teammate\'s activity into its lane@login, with its avatar cleaned', () => {
    expect(incoming('jorgecasar', { ...start, avatar: { emblem: 'fox', colors: { pilot: '#000000' } } })).toEqual({
      ...start, lane: 'kj-stage@jorgecasar', owner: 'jorgecasar', avatar: { emblem: 'fox', colors: {} },
    });
  });

  it('drops anything off the contract', () => {
    expect(incoming('jorgecasar', { ...start, phase: 'boom' })).toBeNull();
    expect(incoming('jorgecasar', { ...start, lane: '../x' })).toBeNull();
    expect(incoming('jorgecasar', { ...start, agent: 'x'.repeat(65) })).toBeNull();
    expect(incoming('jorgecasar', { type: 'sentinel-deny' })).toBeNull();
    expect(incoming('jorgecasar', null)).toBeNull();
  });
});

describe('createTeamFloor', () => {
  it('keeps who of each teammate works, as lanes of the factory, and forgets who ended', () => {
    const floor = createTeamFloor();
    floor.apply(incoming('jorgecasar', start));
    floor.apply(incoming('jorgecasar', { ...start, id: 's2', role: 'reviewer' }));
    expect(floor.lanes()).toEqual([{
      lane: 'kj-stage@jorgecasar', owner: 'jorgecasar', title: 'kj-stage', remote: true, remoteWorking: true,
      working: [expect.objectContaining({ id: 's1', role: 'coder' }), expect.objectContaining({ id: 's2', role: 'reviewer' })],
    }]);
    floor.apply(incoming('jorgecasar', { ...start, phase: 'end' }));
    floor.apply(incoming('jorgecasar', { ...start, id: 's2', role: 'reviewer', phase: 'end' }));
    expect(floor.lanes()).toEqual([]);
  });

  it('forgets everyone of a teammate who left the room', () => {
    const floor = createTeamFloor();
    floor.apply(incoming('jorgecasar', start));
    floor.leave('jorgecasar');
    expect(floor.lanes()).toEqual([]);
  });
});
