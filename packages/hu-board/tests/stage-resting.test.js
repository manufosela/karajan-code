// KJC-TSK-1805 (the maintainer, 2026-11-26): a factory showed the amber "1" with nothing to do. It
// was an open session that had ended its turn asking for nothing. Such a session rests: it is drawn
// at its desk, without the badge, and the strip and the panel say "resting", not "waits for you".
import { describe, expect, it } from 'vitest';

import { NBSP, censusLines, censusOf } from '../public/stage/census.js';
import { withCoffee } from '../public/stage/coffee.js';
import { laneStatus } from '../public/stage/lane-status.js';
import { liveEntries, panelBadge, panelEntries, panelLine } from '../public/stage/project-panel.js';
import { tagText } from '../public/stage/robot-labels.js';

const resting = { agent: 'claude', role: 'host', id: 's1', waiting: 'rest' };
const factory = (working, mail = 0) => ({ project: 'p', name: 'p', lanes: [{ lane: 'main', working, mail, cards: [] }] });

describe('a resting session', () => {
  it('gives the factory no badge, and the panel says it rests', () => {
    const [entry] = panelEntries([factory([resting])]);
    expect(panelBadge(entry)).toBeNull();
    expect(panelLine(entry)).toBe('1 resting');
    expect(liveEntries([entry])).toEqual([entry]);
  });

  it('one that asks the person still gives the badge', () => {
    const [entry] = panelEntries([factory([{ ...resting, waiting: 'person' }, { agent: 'claude', role: 'coder' }])]);
    expect(panelBadge(entry)).toMatchObject({ text: '1' });
    expect(panelLine(entry)).toBe('2 at work');
  });

  it('the strip counts it apart', () => {
    const census = censusOf([factory([resting, { role: 'coder' }])]);
    expect(census).toMatchObject({ resting: 1, coding: 1, waiting: 0, working: 0 });
    expect(censusLines(census).karajan.replaceAll(NBSP, ' ')).toBe('1 coding · 1 resting');
  });

  it('its robot says it rests', () => {
    expect(tagText(resting, { own: null })).toBe('claude · resting');
  });

  it('its lane is idle, not waiting for the person', () => {
    expect(laneStatus({ lane: 'main', working: [resting] })).toEqual({ state: 'idle', why: 'its host rests' });
  });

  it('its lane still waits for the person while its mail waits', () => {
    expect(laneStatus({ lane: 'main', working: [resting], mail: 1 })).toEqual({ state: 'waiting-person', why: 'waits for you: 1 handoff' });
  });

  it('the coffee cart serves it no cup', () => {
    expect(withCoffee([], [{ key: 'a', waiting: 'rest', spot: { x: 0, z: 0 } }], 1000)).toEqual([]);
  });
});
