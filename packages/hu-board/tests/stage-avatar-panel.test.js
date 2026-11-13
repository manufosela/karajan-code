// KJC-TSK-1570 (ADR 0056, point 2): the panel of the scene where a person picks their emblem and,
// for each role they want, a colour of its own. The dialog itself is checked in the browser;
// here, what a filled form saves.
import { describe, expect, it } from 'vitest';

import { avatarFromForm, formOf } from '../public/stage/avatars.js';

// KJC-TSK-1603 (the maintainer, 2026-11-13): one colour of the person's own, for all their robots;
// no colour per role.
describe('avatarFromForm', () => {
  it('keeps the picked emblem and the person\'s colour when ticked as their own', () => {
    expect(avatarFromForm([['emblem', 'owl'], ['own-color', 'on'], ['color', '#FFCC00']])).toEqual({ emblem: 'owl', color: '#ffcc00' });
    expect(avatarFromForm([['emblem', 'owl'], ['color', '#FFCC00']])).toEqual({ emblem: 'owl', color: null });
  });

  it('is cleaned like any avatar: no emblem when none or an unknown one was picked', () => {
    expect(avatarFromForm([['emblem', 'dragon'], ['own-color', 'on'], ['color', 'red']])).toEqual({ emblem: null, color: null });
    expect(avatarFromForm([])).toEqual({ emblem: null, color: null });
  });
});

describe('formOf', () => {
  it('fills the form from a saved avatar: its emblem and its colour, ticked', () => {
    expect(formOf({ emblem: 'fox', color: '#ffcc00' })).toEqual({ emblem: 'fox', own: true, color: '#ffcc00' });
  });

  it('a saved colour per role comes as the person\'s colour', () => {
    expect(formOf({ emblem: 'fox', colors: { host: '#ffcc00' } }).color).toBe('#ffcc00');
  });

  it('starts empty without an avatar', () => {
    expect(formOf(null)).toEqual({ emblem: null, own: false, color: '#c0c8d0' });
  });
});
