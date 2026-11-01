// KJC-TSK-1324: the ▶ on a pending card. board-view.js and hu-actions.js are classic browser
// scripts, so they load into a node:vm context with the app's helpers stubbed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = (file) => readFileSync(fileURLToPath(new URL(`../public/utils/${file}`, import.meta.url)), 'utf8');

function board({ confirm = true, response = { status: 200, body: { commandId: 'cmd-hu-start-1' } } } = {}) {
  const calls = { errors: [], fetches: [], logs: [] };
  const ctx = {
    window: {},
    console,
    esc: (s) => String(s),
    showConfirm: async () => confirm,
    showError: async (msg, opts) => { calls.errors.push({ msg, title: opts?.title }); },
    openCommandLogViewer: (label, id) => calls.logs.push([label, id]),
    fetch: async (url, init) => {
      calls.fetches.push({ url, body: JSON.parse(init.body) });
      return { ok: response.status < 400, status: response.status, json: async () => response.body };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source('board-view.js'), ctx);
  vm.runInContext(source('hu-actions.js'), ctx);
  return { ctx, calls, start: (id) => ctx.window.startCardLane(id, { stopPropagation: () => {} }) };
}

describe('renderPlayButton — KJC-TSK-1324', () => {
  it('shows ▶ only on a pending card without a lane', () => {
    const { ctx } = board();
    expect(ctx.renderPlayButton({ id: 'p::HU-1', status: 'pending' })).toMatch(/story-card__play.*startCardLane\('p::HU-1', event\)/s);
    expect(ctx.renderPlayButton({ id: 'p::HU-1', status: 'running' })).toBe('');
    vm.runInContext("lanesByStory = { 'p::HU-1': [{ slug: 'HU-1-x' }] }", ctx);
    expect(ctx.renderPlayButton({ id: 'p::HU-1', status: 'pending' })).toBe('');
  });
});

describe('startCardLane — KJC-TSK-1324', () => {
  it('after the confirmation it posts the project and opens the run log', async () => {
    const { calls, start } = board();
    await start('p::HU-1');
    expect(calls.fetches).toEqual([{ url: '/api/hu/HU-1/start', body: { project: 'p' } }]);
    expect(calls.logs).toEqual([['hu start HU-1', 'cmd-hu-start-1']]);
  });

  it('a cancelled confirmation launches nothing; a story id that is not a board card is an error', async () => {
    const cancelled = board({ confirm: false });
    await cancelled.start('p::HU-1');
    expect(cancelled.calls.fetches).toEqual([]);
    const odd = board();
    await odd.start('no-separator');
    expect(odd.calls.errors[0].msg).toMatch(/Not a board card/);
    expect(odd.calls.fetches).toEqual([]);
  });

  it('a card with a lane says where it is; any other refusal shows its message', async () => {
    const conflict = board({ response: { status: 409, body: { lane: '/repo/.kj/worktrees/HU-1-x' } } });
    await conflict.start('p::HU-1');
    expect(conflict.calls.errors[0]).toMatchObject({ title: 'Card already started', msg: expect.stringMatching(/cd \/repo\/\.kj\/worktrees\/HU-1-x/) });
    expect(conflict.calls.logs).toEqual([]);
    const refused = board({ response: { status: 400, body: { error: 'not a card id' } } });
    await refused.start('p::HU-1');
    expect(refused.calls.errors[0]).toMatchObject({ msg: 'not a card id', title: 'Could not start the card' });
  });
});
