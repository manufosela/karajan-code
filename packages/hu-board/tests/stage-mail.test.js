// KJC-TSK-1472: the human's mailbox. A factory has mail while one of its lanes
// holds a pending handoff (kj handoff add): something only the human can do.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pendingMail } from '../src/stage-mail.js';
import { watchStageFeed } from '../src/stage-feed.js';
import { lastStageState } from '../src/stage-state.js';

let dir;
const box = (...p) => join(dir, '.karajan', 'handoffs', ...p);
const handoff = (id, status) => writeFileSync(box(`${id}.json`), JSON.stringify({ id, status, command: 'npm publish' }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stage-mail-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('pendingMail', () => {
  it('is 0 without a handoffs folder', () => {
    expect(pendingMail(dir)).toBe(0);
  });

  it('counts only the pending handoffs; a done, unreadable or foreign file does not count', () => {
    mkdirSync(box(), { recursive: true });
    handoff('aaaaaaaa', 'pending');
    handoff('bbbbbbbb', 'pending');
    handoff('cccccccc', 'done');
    writeFileSync(box('dddddddd.json'), 'not json');
    writeFileSync(box('notes.json'), JSON.stringify({ status: 'pending' }));
    expect(pendingMail(dir)).toBe(2);
  });

  it('the lane state carries its mail', () => {
    mkdirSync(box(), { recursive: true });
    handoff('aaaaaaaa', 'pending');
    expect(lastStageState(dir).mail).toBe(1);
  });
});

describe('the mail event', () => {
  let watcher;
  const watch = (paths, opts) => { watcher = Object.assign(new EventEmitter(), { opts, close() {} }); return watcher; };

  it('a new or changed handoff sends the lane its pending count, tagged with the project', () => {
    mkdirSync(box(), { recursive: true });
    const sent = [];
    watchStageFeed(dir, (ev) => sent.push(ev), { project: 'demo', watch, warn: () => {} });
    expect(watcher.opts.ignored(box())).toBe(false);
    expect(watcher.opts.ignored(box('aaaaaaaa.json'))).toBe(false);
    handoff('aaaaaaaa', 'pending');
    watcher.emit('add', box('aaaaaaaa.json'));
    handoff('aaaaaaaa', 'done');
    watcher.emit('change', box('aaaaaaaa.json'));
    expect(sent).toEqual([{ type: 'mail', pending: 1, project: 'demo' }, { type: 'mail', pending: 0, project: 'demo' }]);
  });
});
