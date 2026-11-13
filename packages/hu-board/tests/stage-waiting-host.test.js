// KJC-TSK-1607 (the maintainer, 2026-11-13): a host that ends its turn waiting (KJC-TSK-1606 tells
// for what) stays at its desk, its laptop closed, and says it: waiting for the person or for a
// process. Its next start sets it typing again; with nothing to wait for it leaves as before.
import { describe, expect, it } from 'vitest';

import { laneStatus } from '../public/stage/lane-status.js';
import { panelEntries } from '../public/stage/project-panel.js';
import { withEvent } from '../public/stage/rest.js';
import { tagText } from '../public/stage/robot-labels.js';
import { WALK_MS, spotOf, withActivity, workerAt, workersFrom } from '../public/stage/workers.js';

const host = (phase, extra = {}) => ({ type: 'agent-activity', agent: 'claude', role: 'host', phase, id: 's1', lane: 'main', at: 'x', ...extra });
const own = { login: 'manufosela' };

describe('the floor', () => {
  it('a host that ends waiting stays at its desk, not typing, and its next start clears it', () => {
    let workers = withActivity([], host('start'), 0);
    workers = withActivity(workers, host('end', { waits: 'person' }), 10_000);
    expect(workers[0]).toMatchObject({ waiting: 'person' });
    expect(workers[0].leftAt).toBeUndefined();
    expect(workerAt(workers[0], 20_000)).toMatchObject({ ...spotOf('host'), walking: false, waiting: true });
    workers = withActivity(workers, host('start'), 30_000);
    expect(workers).toHaveLength(1);
    expect(workers[0].waiting).toBeUndefined();
  });

  it('one that ends with nothing to wait for leaves as before', () => {
    let workers = withActivity([], host('start'), 0);
    workers = withActivity(workers, host('end'), 10_000);
    expect(workers[0].leftAt).toBe(10_000);
  });

  it('one already waiting when the stage opens sits waiting at its desk', () => {
    const [w] = workersFrom([{ agent: 'claude', role: 'host', id: 's1', at: 'x', waiting: 'process' }], 5000, 'main');
    expect(w.waiting).toBe('process');
    expect(workerAt(w, 5000 + WALK_MS)).toMatchObject({ walking: false, waiting: true });
  });
});

describe('the lane\'s state', () => {
  it('keeps a host that ends waiting, with what for, and its next start clears it', () => {
    let state = withEvent({}, host('start'));
    state = withEvent(state, host('end', { waits: 'person' }));
    expect(state.working).toMatchObject([{ id: 's1', waiting: 'person' }]);
    state = withEvent(state, host('start'));
    expect(state.working[0]).not.toHaveProperty('waiting');
  });

  it('a lane whose only work is a host waiting for the person waits for the person', () => {
    expect(laneStatus({ lane: 'main', working: [{ role: 'host', waiting: 'person' }] })).toEqual({ state: 'waiting-person', why: 'its host waits for you' });
    expect(laneStatus({ lane: 'main', working: [{ role: 'host', waiting: 'process' }] }).state).toBe('working');
    expect(laneStatus({ lane: 'main', working: [{ role: 'host', waiting: 'person' }, { role: 'coder' }] }).state).toBe('working');
  });
});

describe('what it says', () => {
  it('its label says whose it is and what it waits for', () => {
    expect(tagText({ agent: 'claude', role: 'host', waiting: 'person' }, { own })).toBe('manufosela · waits for you');
    expect(tagText({ agent: 'claude', role: 'host', waiting: 'process' }, { own })).toBe('manufosela · waits for a process');
  });

  it('the factories panel counts a host waiting for the person', () => {
    const lanes = [{ lane: 'main', working: [{ role: 'host', waiting: 'person' }], cards: [], mail: 1 }];
    expect(panelEntries([{ project: 'p', name: 'p', lanes }], null)[0].waiting).toBe(2);
  });
});
