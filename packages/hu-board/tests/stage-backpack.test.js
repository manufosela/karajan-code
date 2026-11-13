// KJC-TSK-1569 (ADR 0056, point 2): each robot carries its owner's emblem on a backpack and wears
// the colour its owner gave its role. The backpack itself is a three.js mesh (backpack.js),
// checked in the browser; here, what decides it.
import { describe, expect, it } from 'vitest';

import { avatarFor, glyphOf, ownerColor } from '../public/stage/avatars.js';

// KJC-TSK-1603 (the maintainer, 2026-11-13): one colour per person, which marks all their robots.
const own = { emblem: 'fox', color: '#ffcc00' };

describe('avatarFor', () => {
  it('is the own avatar for an own robot, the one it brings for a teammate\'s', () => {
    expect(avatarFor({ agent: 'claude' }, own)).toBe(own);
    const theirs = { emblem: 'owl', color: '#22aa66' };
    expect(avatarFor({ agent: 'claude', avatar: theirs }, own)).toEqual(theirs);
  });

  it('cleans what a teammate\'s robot brings, and is none without any', () => {
    expect(avatarFor({ avatar: { emblem: 'dragon', color: 'red' } }, own)).toEqual({ emblem: null, color: null });
    expect(avatarFor({ agent: 'claude' }, null)).toBeNull();
  });
});

describe('ownerColor', () => {
  it('is the owner\'s colour as a number, none without one', () => {
    expect(ownerColor(own)).toBe(0xffcc00);
    expect(ownerColor({ emblem: 'fox', color: null })).toBeNull();
    expect(ownerColor(null)).toBeNull();
  });
});

describe('glyphOf', () => {
  it('draws a known emblem and nothing for none', () => {
    expect(glyphOf('fox')).toBe('🦊');
    expect(glyphOf(null)).toBeNull();
    expect(glyphOf('dragon')).toBeNull();
  });
});
