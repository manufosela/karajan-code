// KJC-TSK-1590 (asked by the maintainer on 2026-11-13): a side panel lists the projects and opens
// only the chosen factory, instead of every factory at once.
import { describe, expect, it } from 'vitest';

import { panelBadge, panelEntries, panelHref, panelLine } from '../public/stage/project-panel.js';

const lane = (name, working = 0, cards = []) => ({ lane: name, working: Array.from({ length: working }, () => ({ agent: 'claude' })), cards });
const card = (id, status) => ({ id, status, lane: 'main', at: '2026-11-13T08:00:00.000Z' });

describe('panelEntries', () => {
  const factories = [
    { project: 'home_a', name: 'karajan-code', lanes: [lane('main', 1, [card('HU-1', 'running')]), lane('HU-2-x', 2, [card('HU-2', 'running'), card('HU-3', 'done')])] },
    { project: 'home_b', name: 'grebla', lanes: [lane('main')] },
  ];

  it('one entry per factory, in the map order, with its agents at work and its cards in progress', () => {
    expect(panelEntries(factories, 'home_b')).toEqual([
      { project: 'home_a', name: 'karajan-code', working: 3, doing: 2, waiting: 0, current: false },
      { project: 'home_b', name: 'grebla', working: 0, doing: 0, waiting: 0, current: true },
    ]);
  });

  // KJC-TSK-1605 (the maintainer, 2026-11-13): the panel flags the factories that need a human.
  it('counts the handoffs that wait for the human in every lane of a factory', () => {
    const mailed = [{ project: 'p', name: 'p', lanes: [{ ...lane('main'), mail: 2 }, { ...lane('x'), mail: 1 }, lane('y')] }];
    expect(panelEntries(mailed, null)[0].waiting).toBe(3);
  });

  it('a card that went through two lanes counts once', () => {
    const twice = [{ project: 'p', name: 'p', lanes: [lane('main', 0, [card('HU-1', 'running')]), lane('x', 0, [card('HU-1', 'running')])] }];
    expect(panelEntries(twice, null)[0].doing).toBe(1);
  });
});

describe('panelLine', () => {
  it('says what goes on in it, or that it is quiet', () => {
    expect(panelLine({ working: 3, doing: 2 })).toBe('3 at work · 2 in progress');
    expect(panelLine({ working: 1, doing: 0 })).toBe('1 at work');
    expect(panelLine({ working: 0, doing: 1 })).toBe('1 in progress');
    expect(panelLine({ working: 0, doing: 0 })).toBe('quiet');
  });
});

describe('panelBadge', () => {
  it('says how many things wait for the human, for the eye and for a screen reader; none when nothing does', () => {
    expect(panelBadge({ waiting: 3 })).toEqual({ text: '3', label: '3 waiting for you' });
    expect(panelBadge({ waiting: 1 })).toEqual({ text: '1', label: '1 waiting for you' });
    expect(panelBadge({ waiting: 0 })).toBeNull();
  });
});

describe('panelHref', () => {
  it('opens the factory of that project alone', () => {
    expect(panelHref('home_manu_ws npm/x')).toBe('/stage.html?project=home_manu_ws%20npm%2Fx');
  });
});
