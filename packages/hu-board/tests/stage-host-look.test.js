// KJC-TSK-1598 (the maintainer, 2026-11-13): each host stands out from every other robot, and one
// person's host from another's: a little bigger, a halo of light in its owner's host colour, its
// owner's emblem on its chest and its owner's login on its label.
import { describe, expect, it } from 'vitest';

import { HOST_SCALE, chestOf, hologramOf, hostColor, hostLabel, laptopLift, ownerOf } from '../public/stage/host-look.js';
import { accentOf } from '../public/stage/workers.js';

const own = { emblem: 'owl', color: '#123456', login: 'manufosela' };
const mine = { agent: 'claude', role: 'host', lane: 'main', name: null, tool: 'Edit' };
const jorges = { agent: 'codex', role: 'host', lane: 'feat@jorge', owner: 'jorge', avatar: { emblem: 'fox', color: null }, tool: null };

describe('a host\'s look', () => {
  it('is a little bigger than any other robot', () => {
    expect(HOST_SCALE).toBeGreaterThan(1);
    expect(HOST_SCALE).toBeLessThan(1.5);
  });

  it('says whose it is: a teammate\'s by its owner, the own one by the own login, none without it', () => {
    expect(ownerOf(jorges, own)).toBe('jorge');
    expect(ownerOf(mine, own)).toBe('manufosela');
    expect(ownerOf(mine, { ...own, login: null })).toBeNull();
  });

  it('its label starts with its owner, then what it said before', () => {
    expect(hostLabel(mine, own)).toBe('manufosela · claude · Edit');
    expect(hostLabel(jorges, own)).toBe('jorge · codex');
    expect(hostLabel(mine, null)).toBe('claude · Edit');
  });

  // KJC-TSK-1603: one colour per person, the one that marks all their robots.
  it('its hologram and chest plate are its owner\'s colour, else its agent\'s', () => {
    expect(hostColor(mine, own)).toBe(0x123456);
    expect(hostColor(jorges, jorges.avatar)).toBe(accentOf('codex'));
  });

  // KJC-TSK-1601 (the maintainer, 2026-11-13): a hologram over its head instead of a halo.
  it('its hologram shows its owner\'s emblem, else its owner\'s initial, else its agent\'s', () => {
    expect(hologramOf(mine, own, own)).toBe('🦉');
    expect(hologramOf(jorges, jorges.avatar, own)).toBe('🦊');
    expect(hologramOf(mine, { emblem: null, color: null }, own)).toBe('M');
    expect(hologramOf({ ...jorges, avatar: undefined }, { emblem: null, color: null }, own)).toBe('J');
    expect(hologramOf(mine, { emblem: null, color: null }, null)).toBe('C');
  });

  it('its chest shows its owner\'s emblem, else its agent\'s name as before', () => {
    expect(chestOf(mine, own)).toBe('🦉');
    expect(chestOf(jorges, jorges.avatar)).toBe('🦊');
    expect(chestOf(mine, { emblem: null, color: null })).toBe('claude');
  });

  it('its laptop is drawn back to the height and reach every other robot\'s has, over its desk', () => {
    const plain = { up: 0.62, ahead: 1.05 };
    expect(laptopLift(1)).toEqual({ ...plain, scale: 1 });
    const lifted = laptopLift(HOST_SCALE);
    expect(HOST_SCALE * (0.1 + lifted.up)).toBeCloseTo(0.1 + plain.up);
    expect(HOST_SCALE * lifted.ahead).toBeCloseTo(plain.ahead);
    expect(HOST_SCALE * lifted.scale).toBeCloseTo(1);
  });
});
