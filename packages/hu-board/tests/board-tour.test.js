// KJC-TSK-1198: the guided tour of the HU Board. Its steps follow what is on screen, it
// starts by itself only the first time, and the help modal can relaunch it.
//
// board-tour.js is a classic browser script (no exports), so the test loads it into a
// node:vm context with a fake document, localStorage and driver.js global.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  fileURLToPath(new URL('../public/utils/board-tour.js', import.meta.url)),
  'utf8'
);

function load({ present = [], stored = null, brokenStorage = false } = {}) {
  const store = new Map(stored === null ? [] : [['kj-board-tour-seen', stored]]);
  const localStorage = brokenStorage
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
    : { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const document = { querySelector: (sel) => (present.includes(sel) ? { offsetParent: {} } : null) };
  const started = [];
  const driver = { js: { driver: (config) => ({ drive: () => started.push(config) }) } };
  const ctx = { document, localStorage, window: { driver }, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, store, started };
}

const HEADER = ['[data-view="dashboard"]', '#help-btn', '#config-btn'];
const BOARD = ['#project-nav', '#preflight-panel', '#rag-panel'];

describe('board tour (KJC-TSK-1198)', () => {
  it('highlights every element that is on screen, header first', () => {
    const { ctx } = load({ present: [...HEADER, ...BOARD] });
    const elements = ctx.boardTourSteps().map((s) => s.element).filter(Boolean);
    expect(elements.slice(0, 3)).toEqual(HEADER);
    expect(elements).toEqual(expect.arrayContaining(BOARD));
  });

  it('explains the project tabs without highlighting them when no project is loaded', () => {
    const { ctx } = load({ present: HEADER });
    const steps = ctx.boardTourSteps();
    expect(steps.filter((s) => s.element).every((s) => HEADER.includes(s.element))).toBe(true);
    expect(steps.some((s) => !s.element && /open a project/i.test(s.popover.description))).toBe(true);
  });

  it('starts by itself the first time only, and remembers it once it is closed', () => {
    const first = load({ present: HEADER });
    expect(first.ctx.maybeStartFirstTour()).toBe(true);
    first.started[0].onDestroyed();
    expect(first.store.get('kj-board-tour-seen')).toBe('1');
    const again = load({ present: HEADER, stored: '1' });
    expect(again.ctx.maybeStartFirstTour()).toBe(false);
    expect(again.started).toHaveLength(0);
  });

  it('does not start by itself when the browser cannot remember it', () => {
    const { ctx, started } = load({ present: HEADER, brokenStorage: true });
    expect(ctx.maybeStartFirstTour()).toBe(false);
    expect(started).toHaveLength(0);
  });

  it('the help button relaunches the whole tour, keyboard enabled, even after it was seen', () => {
    const { ctx, started } = load({ present: HEADER, stored: '1' });
    ctx.startBoardTour();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ allowKeyboardControl: true, showProgress: true });
  });
});
