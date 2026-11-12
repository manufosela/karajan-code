// KJC-TSK-1552 (ADR 0054, slice 4a; decided by the maintainer on 2026-11-12): while an agent works
// on a HU in progress, the board posts a status on the HU's issue at most once an hour, and a
// stopped status once when its lane stops.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STATUS_EVERY_MS, beatStatus, statusPosts } from '../src/link-status.js';

const HOUR = STATUS_EVERY_MS;
const lanes = [
  { lane: 'main', working: [] },
  { lane: 'a', working: [{ role: 'host' }] },
  { lane: 'b', working: [] },
];
const cards = [
  { id: 'HU-10', status: 'running', lane: 'a' },
  { id: 'HU-11', status: 'done', lane: 'a' },
  { id: 'HU-20', status: 'running', lane: 'b' },
  { id: 'PRJ-1', status: 'running', lane: 'a' },
];

describe('statusPosts', () => {
  it('posts working on each shared HU in progress of a lane at work, and nothing else', () => {
    expect(statusPosts(lanes, cards, {}, 0).posts).toEqual([{ id: 'HU-10', issue: 10, state: 'working' }]);
  });

  it('posts working again only an hour after the last one', () => {
    const last = { 'HU-10': { state: 'working', at: 0 } };
    expect(statusPosts(lanes, cards, last, HOUR - 1).posts).toEqual([]);
    expect(statusPosts(lanes, cards, last, HOUR).posts).toEqual([{ id: 'HU-10', issue: 10, state: 'working' }]);
  });

  it('posts stopped once when a HU it said was worked on is no longer, and then nothing', () => {
    const quiet = lanes.map((l) => ({ ...l, working: [] }));
    const { posts, next } = statusPosts(quiet, cards, { 'HU-10': { state: 'working', at: 0 } }, 5);
    expect(posts).toEqual([{ id: 'HU-10', issue: 10, state: 'stopped' }]);
    expect(statusPosts(quiet, cards, next, 10).posts).toEqual([]);
  });
});

describe('beatStatus', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'link-status-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('sends each post through kj link and records only the ones that went out', async () => {
    const sent = [];
    const send = async (cwd, post) => { sent.push([cwd, post.issue, post.state]); if (post.issue === 20) throw new Error('no network'); };
    const both = [{ lane: 'a', working: [{ role: 'host' }] }, { lane: 'b', working: [{ role: 'host' }] }];
    const warned = [];
    await beatStatus(dir, { lanesOf: () => both.map((l) => ({ ...l, cards: cards.filter((c) => c.lane === l.lane) })), send, now: () => 7, log: { warn: (m) => warned.push(m) } });
    expect(sent).toEqual([[dir, 10, 'working'], [dir, 20, 'working']]);
    expect(warned).toHaveLength(1);
    const record = JSON.parse(readFileSync(join(dir, '.karajan', 'link-status.json'), 'utf8'));
    expect(record).toEqual({ 'HU-10': { state: 'working', at: 7 } });
  });
});
