// KJC-TSK-1811 (the maintainer, 2026-11-27): a session that stops because no work is left is not a
// wait. It stays at its desk with a green check and a "done" label, counted apart from the waits and
// from a resting session, and the factory shows no badge for it.
import { describe, expect, it } from 'vitest';

import { NBSP, censusLines, censusOf } from '../public/stage/census.js';
import { withCoffee } from '../public/stage/coffee.js';
import { laneStatus } from '../public/stage/lane-status.js';
import { liveEntries, panelBadge, panelEntries, panelLine } from '../public/stage/project-panel.js';
import { tagText } from '../public/stage/robot-labels.js';
import { waitLook } from '../public/stage/wait-look.js';
import { waitOf } from '../src/stop-reason.js';

const done = { agent: 'claude', role: 'host', id: 's1', waiting: 'done' };
const factory = (working, mail = 0) => ({ project: 'p', name: 'p', lanes: [{ lane: 'main', working, mail, cards: [] }] });

describe('a session with no work left', () => {
  it('its stop line says it is done, not that it waits', () => {
    expect(waitOf('Me paro por no quedar trabajo pendiente.')).toBe('done');
    expect(waitOf('Me paro porque ya no quedan tareas.')).toBe('done');
    expect(waitOf('Hecho, mergeado.')).toBeNull();
  });

  it('gives the factory no badge, and the panel says it is done', () => {
    const [entry] = panelEntries([factory([done])]);
    expect(panelBadge(entry)).toBeNull();
    expect(panelLine(entry)).toBe('1 done');
    expect(liveEntries([entry])).toEqual([entry]);
  });

  it('the strip counts it apart from the resting ones', () => {
    const census = censusOf([factory([done, { ...done, id: 's2', waiting: 'rest' }])]);
    expect(census).toMatchObject({ done: 1, resting: 1, waiting: 0, working: 0 });
    expect(censusLines(census).karajan.replaceAll(NBSP, ' ')).toBe('1 resting · 1 done');
  });

  it('its robot says it is done, under a green check', () => {
    expect(tagText(done, { own: null })).toBe('claude · done');
    expect(waitLook('done', 0)).toMatchObject({ mark: 'check', facesCamera: false, hand: 0 });
  });

  it('its lane is idle unless its mail waits, and the coffee cart serves it no cup', () => {
    expect(laneStatus({ lane: 'main', working: [done] })).toEqual({ state: 'idle', why: 'its host is done' });
    expect(laneStatus({ lane: 'main', working: [done], mail: 1 })).toEqual({ state: 'waiting-person', why: 'waits for you: 1 handoff' });
    expect(withCoffee([], [{ key: 'a', waiting: 'done', spot: { x: 0, z: 0 } }], 1000)).toEqual([]);
  });
});
