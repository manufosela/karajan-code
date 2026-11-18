// KJC-TSK-1694 (asked by the maintainer on 2026-11-18): the status lines at the bottom left fold
// and unfold, and the choice stays for the next visit in this browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FOLD_ITEM, mountStatusFold } from '../public/stage/status-fold.js';

const fakeStorage = (start = {}) => {
  const items = { ...start };
  return { getItem: (key) => items[key] ?? null, setItem: (key, value) => { items[key] = String(value); }, items };
};
const fakeButton = () => {
  const attrs = {};
  let onClick = null;
  return {
    setAttribute: (name, value) => { attrs[name] = value; },
    addEventListener: (type, fn) => { if (type === 'click') onClick = fn; },
    click: () => onClick?.(),
    attrs,
  };
};
const fakeList = () => {
  const names = new Set();
  return { classList: { toggle: (name, on) => (on ? names.add(name) : names.delete(name)) }, folded: () => names.has('stage-folded') };
};

describe('the stage page', () => {
  const page = readFileSync(new URL('../public/stage.html', import.meta.url), 'utf8');

  it('puts the fold button over the status list it controls', () => {
    expect(page).toMatch(/<button type="button" id="stage-status-fold" aria-controls="stage-status" aria-expanded="true">/);
  });

  it('folds the lines out of view without silencing them', () => {
    expect(page).toMatch(/#stage-status\.stage-folded \{[^}]*clip-path: inset\(50%\)/);
  });
});

describe('mountStatusFold', () => {
  it('starts unfolded when nothing was chosen, and says so', () => {
    const button = fakeButton();
    const list = fakeList();
    mountStatusFold({ button, list, storage: () => fakeStorage() });
    expect(list.folded()).toBe(false);
    expect(button.attrs['aria-expanded']).toBe('true');
  });

  it('folds and unfolds on each click, and remembers the last choice', () => {
    const button = fakeButton();
    const list = fakeList();
    const store = fakeStorage();
    mountStatusFold({ button, list, storage: () => store });
    button.click();
    expect(list.folded()).toBe(true);
    expect(button.attrs['aria-expanded']).toBe('false');
    expect(store.items[FOLD_ITEM]).toBe('1');
    button.click();
    expect(list.folded()).toBe(false);
    expect(store.items[FOLD_ITEM]).toBe('0');
  });

  it('opens folded when it was left folded', () => {
    const list = fakeList();
    mountStatusFold({ button: fakeButton(), list, storage: () => fakeStorage({ [FOLD_ITEM]: '1' }) });
    expect(list.folded()).toBe(true);
  });

  it('still folds when the browser keeps no storage', () => {
    const button = fakeButton();
    const list = fakeList();
    const none = () => { throw new Error('blocked'); };
    mountStatusFold({ button, list, storage: none });
    expect(list.folded()).toBe(false);
    button.click();
    expect(list.folded()).toBe(true);
  });
});
