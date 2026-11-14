// KJC-TSK-1620 (asked by the maintainer on 2026-11-14): "over HU-4295-the-signe… it should show a
// tooltip with the rest".
import { describe, expect, it } from 'vitest';

import { WORKSHOP } from '../public/stage/layout.js';
import { huOfLane, laneAtPoint, tipOf } from '../public/stage/workshop-info.js';

const lanes = ['main', 'HU-4295-the-signer-page-says-who-signs'];
const xOf = (lane) => ({ main: -4, 'HU-4295-the-signer-page-says-who-signs': 4 })[lane];
const zOf = () => WORKSHOP.z;

describe('laneAtPoint', () => {
  it('the workshop whose pad or name plate in front of it holds the point', () => {
    expect(laneAtPoint({ x: 4.5, z: WORKSHOP.z }, lanes, xOf, zOf)).toBe('HU-4295-the-signer-page-says-who-signs');
    // The name plate lies on the floor in front of the pad.
    expect(laneAtPoint({ x: -4, z: WORKSHOP.z + WORKSHOP.depth / 2 + 1.2 }, lanes, xOf, zOf)).toBe('main');
  });

  it('none between workshops, far in front of them, or without a point', () => {
    expect(laneAtPoint({ x: 0, z: WORKSHOP.z }, lanes, xOf, zOf)).toBeNull();
    expect(laneAtPoint({ x: 4, z: WORKSHOP.z + 6 }, lanes, xOf, zOf)).toBeNull();
    expect(laneAtPoint(null, lanes, xOf, zOf)).toBeNull();
  });
});

describe('huOfLane', () => {
  const cards = [{ id: 'HU-4295', title: 'The signer page says who signs', status: 'running' }, { id: 'HU-7', title: 'Other' }];

  it('the card a lane is named after, with its title', () => {
    expect(huOfLane('HU-4295-the-signer-page-says-who-signs', cards)).toEqual(cards[0]);
  });

  it('a lane named after a card the stage has not seen still gives its id; main gives none', () => {
    expect(huOfLane('HU-9-something', cards)).toEqual({ id: 'HU-9', title: null });
    expect(huOfLane('main', cards)).toBeNull();
  });
});

describe('tipOf', () => {
  it('the lane\'s whole name, and its HU with the title when known', () => {
    expect(tipOf('HU-4295-the-signer-page-says-who-signs', { id: 'HU-4295', title: 'The signer page' }))
      .toEqual(['HU-4295-the-signer-page-says-who-signs', 'HU-4295 · The signer page']);
    expect(tipOf('HU-9-x', { id: 'HU-9', title: null })).toEqual(['HU-9-x', 'HU-9']);
    expect(tipOf('main@manufosela', null)).toEqual(['main']);
  });

  it('says nothing twice: a lane named just as its HU, without a title, is its name alone', () => {
    expect(tipOf('HU-3864', { id: 'HU-3864', title: null })).toEqual(['HU-3864']);
  });

  it('adds the lane\'s status line, which the plate cuts too, whole', () => {
    expect(tipOf('main', null, 'idle: @teammate: lane states of every board')).toEqual(['main', 'idle: @teammate: lane states of every board']);
  });
});
