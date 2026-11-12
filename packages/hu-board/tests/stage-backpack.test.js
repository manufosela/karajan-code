// KJC-TSK-1569 (ADR 0056, point 2): each robot carries its owner's emblem on a backpack and wears
// the colour its owner gave its role. The backpack itself is a three.js mesh (backpack.js),
// checked in the browser; here, what decides it.
import { describe, expect, it } from 'vitest';

import { accentFor, avatarFor, glyphOf } from '../public/stage/avatars.js';
import { accentOf } from '../public/stage/workers.js';

const own = { emblem: 'fox', colors: { coder: '#ff8800' } };

describe('avatarFor', () => {
  it('is the own avatar for an own robot, the one it brings for a teammate\'s', () => {
    expect(avatarFor({ agent: 'claude' }, own)).toBe(own);
    const theirs = { emblem: 'owl', colors: {} };
    expect(avatarFor({ agent: 'claude', avatar: theirs }, own)).toEqual(theirs);
  });

  it('cleans what a teammate\'s robot brings, and is none without any', () => {
    expect(avatarFor({ avatar: { emblem: 'dragon', colors: { coder: 'red' } } }, own)).toEqual({ emblem: null, colors: {} });
    expect(avatarFor({ agent: 'claude' }, null)).toBeNull();
  });
});

describe('accentFor', () => {
  it('is the colour the owner gave the role, else the agent\'s', () => {
    expect(accentFor({ agent: 'claude', role: 'coder' }, own)).toBe(0xff8800);
    expect(accentFor({ agent: 'claude', role: 'reviewer' }, own)).toBe(accentOf('claude'));
    expect(accentFor({ agent: 'codex', role: 'coder' }, null)).toBe(accentOf('codex'));
  });
});

describe('glyphOf', () => {
  it('draws a known emblem and nothing for none', () => {
    expect(glyphOf('fox')).toBe('🦊');
    expect(glyphOf(null)).toBeNull();
    expect(glyphOf('dragon')).toBeNull();
  });
});
