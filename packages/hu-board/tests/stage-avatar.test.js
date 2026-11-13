// KJC-TSK-1565 (ADR 0056, decided by the maintainer on 2026-11-12): each person's avatar is a
// backpack with an emblem picked from a list, and each role may get its own colour. The board
// keeps the choice; the scene draws it and, later, it travels with the own activity.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { describe, expect, it } from 'vitest';

import { EMBLEMS, ROLES, cleanAvatar } from '../public/stage/avatars.js';
import { readAvatar, saveAvatar } from '../src/stage-avatar.js';

// KJC-TSK-1603 (the maintainer, 2026-11-13): one colour per person, which marks all their robots;
// no colour per role.
describe('cleanAvatar', () => {
  it('keeps a known emblem and the person\'s #rrggbb colour', () => {
    expect(cleanAvatar({ emblem: 'fox', color: '#FFCC00' })).toEqual({ emblem: 'fox', color: '#ffcc00' });
  });

  it('drops an unknown emblem and a colour that is not #rrggbb', () => {
    expect(cleanAvatar({ emblem: 'dragon', color: 'yellow' })).toEqual({ emblem: null, color: null });
    expect(cleanAvatar({ emblem: 'cat', color: '#12345' })).toEqual({ emblem: 'cat', color: null });
  });

  it('drops a colour that is not a string, even one that reads as #rrggbb', () => {
    expect(cleanAvatar({ emblem: 'cat', color: { toString: () => '#ffffff' } })).toEqual({ emblem: 'cat', color: null });
  });

  it('turns a colour per role, saved before or sent by an older kj, into the host\'s, else the first', () => {
    expect(cleanAvatar({ emblem: 'owl', colors: { coder: '#FF8800', host: '#FFCC00' } })).toEqual({ emblem: 'owl', color: '#ffcc00' });
    expect(cleanAvatar({ emblem: 'owl', colors: { reviewer: '#22aa66', coder: 'red' } })).toEqual({ emblem: 'owl', color: '#22aa66' });
    expect(cleanAvatar({ emblem: 'owl', colors: { pilot: '#000000' } })).toEqual({ emblem: 'owl', color: null });
  });

  it('is empty for anything that is not an object', () => {
    for (const bad of [null, 'fox', 3, []]) expect(cleanAvatar(bad)).toEqual({ emblem: null, color: null });
  });

  it('offers about ten emblems and the five roles of the scene', () => {
    expect(EMBLEMS.map((e) => e.id)).toEqual(['fox', 'owl', 'bear', 'cat', 'panda', 'penguin', 'turtle', 'octopus', 'rocket', 'bolt']);
    expect(ROLES).toEqual(['host', 'coder', 'reviewer', 'solomon', 'subagent']);
  });
});

describe('the avatar on the board', () => {
  const home = () => mkdtempSync(join(tmpdir(), 'kj-avatar-'));

  it('is empty until one is saved, and then the cleaned choice', () => {
    const dir = home();
    expect(readAvatar(dir)).toEqual({ emblem: null, color: null });
    expect(saveAvatar(dir, { emblem: 'owl', color: '#ABCDEF' })).toEqual({ emblem: 'owl', color: '#abcdef' });
    expect(readAvatar(dir)).toEqual({ emblem: 'owl', color: '#abcdef' });
    expect(JSON.parse(readFileSync(join(dir, 'hu-board', 'avatar.json'), 'utf8')).emblem).toBe('owl');
  });

  it('is read and saved through /api/stage/me, cleaned', async () => {
    const prev = process.env.KARAJAN_HOME;
    process.env.KARAJAN_HOME = home();
    const { default: apiRoutes } = await import('../src/routes/api.js');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const url = `http://localhost:${server.address().port}/api/stage/me`;
      // KJC-TSK-1597: with the own GitHub login, none while the board is in no room.
      expect(await (await fetch(url)).json()).toEqual({ emblem: null, color: null, login: null });
      const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emblem: 'panda', color: '#123456', x: '#000000' }) });
      expect(await put.json()).toEqual({ emblem: 'panda', color: '#123456' });
      expect(await (await fetch(url)).json()).toEqual({ emblem: 'panda', color: '#123456', login: null });
    } finally {
      await new Promise((r) => server.close(r));
      if (prev === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prev;
    }
  });

  it('reads a broken file as no avatar', () => {
    const dir = home();
    saveAvatar(dir, { emblem: 'cat' });
    writeFileSync(join(dir, 'hu-board', 'avatar.json'), '{broken');
    expect(readAvatar(dir)).toEqual({ emblem: null, color: null });
  });
});
