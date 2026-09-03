// KJC-TSK-0810 (MGL-C) — maggle mode: the board in plain language.
//
// maggle-mode.js is a classic browser script (no exports), so the test
// loads it into a node:vm context with a fake location/localStorage and
// asserts against the hoisted function declarations.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  fileURLToPath(new URL('../public/utils/maggle-mode.js', import.meta.url)),
  'utf8'
);

function loadMaggle({ search = '', stored = null, brokenStorage = false } = {}) {
  const store = new Map();
  if (stored !== null) store.set('kj-maggle-mode', stored);
  const localStorage = brokenStorage
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } }
    : {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      };
  const ctx = { location: { search }, localStorage, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, store };
}

describe('maggle mode (KJC-TSK-0810)', () => {
  it('?maggle=1 turns the mode on and persists it for reloads', () => {
    const { ctx, store } = loadMaggle({ search: '?maggle=1' });
    expect(ctx.isMaggleMode()).toBe(true);
    expect(store.get('kj-maggle-mode')).toBe('1');
  });

  it('without the flag or persistence the board stays technical', () => {
    const { ctx } = loadMaggle();
    expect(ctx.isMaggleMode()).toBe(false);
    expect(ctx.maggleText('column.pending', 'Pending')).toBe('Pending');
  });

  it('a persisted choice survives a reload without the query string', () => {
    const { ctx } = loadMaggle({ stored: '1' });
    expect(ctx.isMaggleMode()).toBe(true);
    expect(ctx.maggleText('column.pending', 'Pending')).toBe('Por hacer');
  });

  it('?maggle=0 turns the mode off and clears the persistence', () => {
    const { ctx, store } = loadMaggle({ stored: '1', search: '?maggle=0' });
    expect(ctx.isMaggleMode()).toBe(false);
    expect(store.has('kj-maggle-mode')).toBe(false);
  });

  it('covers the three kanban columns with plain labels distinct from the jargon', () => {
    const { ctx } = loadMaggle({ stored: '1' });
    for (const [key, jargon] of [
      ['column.pending', 'Pending'],
      ['column.running', 'Running'],
      ['column.done', 'Done'],
    ]) {
      const plain = ctx.maggleText(key, jargon);
      expect(plain).toBeTruthy();
      expect(plain).not.toBe(jargon);
    }
  });

  it('degrades to the technical UI when localStorage is unavailable, never breaks', () => {
    const { ctx } = loadMaggle({ search: '?maggle=1', brokenStorage: true });
    expect(ctx.isMaggleMode()).toBe(false);
    expect(ctx.maggleText('column.done', 'Done')).toBe('Done');
  });
});
