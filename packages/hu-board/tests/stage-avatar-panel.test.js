// KJC-TSK-1570 (ADR 0056, point 2): the panel of the scene where a person picks their emblem and,
// for each role they want, a colour of its own. The dialog itself is checked in the browser;
// here, what a filled form saves.
import { describe, expect, it } from 'vitest';

import { avatarFromForm, formOf } from '../public/stage/avatars.js';

describe('avatarFromForm', () => {
  it('keeps the picked emblem and the colour of each role ticked as its own', () => {
    const entries = [['emblem', 'owl'], ['color-coder', '#FF8800'], ['own-coder', 'on'], ['color-host', '#112233']];
    expect(avatarFromForm(entries)).toEqual({ emblem: 'owl', colors: { coder: '#ff8800' } });
  });

  it('is cleaned like any avatar: no emblem when none or an unknown one was picked', () => {
    expect(avatarFromForm([['emblem', 'dragon'], ['own-pilot', 'on'], ['color-pilot', '#000000']])).toEqual({ emblem: null, colors: {} });
    expect(avatarFromForm([])).toEqual({ emblem: null, colors: {} });
  });
});

describe('formOf', () => {
  it('fills the form from a saved avatar: its emblem, and each role ticked with its colour', () => {
    const form = formOf({ emblem: 'fox', colors: { reviewer: '#00aa55' } });
    expect(form.emblem).toBe('fox');
    expect(form.roles.find((r) => r.role === 'reviewer')).toEqual({ role: 'reviewer', own: true, color: '#00aa55' });
    expect(form.roles.find((r) => r.role === 'coder')).toEqual({ role: 'coder', own: false, color: '#c0c8d0' });
  });

  it('starts empty without an avatar', () => {
    expect(formOf(null).emblem).toBeNull();
    expect(formOf(null).roles.every((r) => !r.own)).toBe(true);
  });
});
