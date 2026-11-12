// KJC-TSK-1553 (ADR 0054, slice 4b): a teammate's workshop lights up while the newest status its
// holder posted on the HU's issue says an agent works on it, and that status is under 70 min old.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FRESH_MS, newestStatus, readTeamStatus, withStatus } from '../src/team-status.js';

const msg = (over) => ({ kind: 'message', type: 'status', context: 'HU-3', author: 'jorge', conclusion: 'HU-3: an agent is working on it', updatedAt: '2026-11-12T10:00:00Z', ...over });

describe('newestStatus', () => {
  it('takes the holder\'s newest status about the card, working or stopped', () => {
    const messages = [msg({}), msg({ updatedAt: '2026-11-12T11:00:00Z', conclusion: 'HU-3: no agent is working on it now' })];
    expect(newestStatus(messages, 'HU-3', 'jorge')).toEqual({ state: 'stopped', at: '2026-11-12T11:00:00Z' });
  });

  it('skips other authors, other cards, other types and broken entries', () => {
    const messages = [msg({ author: 'someone' }), msg({ context: 'HU-4' }), msg({ type: 'blocker' }), { kind: 'broken' }];
    expect(newestStatus(messages, 'HU-3', 'jorge')).toBeNull();
  });
});

describe('withStatus', () => {
  const record = { 'HU-3': { state: 'working', at: '2026-11-12T10:00:00Z', by: 'jorge' } };
  const cards = [{ id: 'HU-3', title: 't' }, { id: 'HU-4', title: 'u' }];

  it('marks working the cards whose holder said so less than 70 min ago', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(withStatus(cards, record, 'jorge', now + FRESH_MS - 1).map((c) => c.working)).toEqual([true, false]);
    expect(withStatus(cards, record, 'jorge', now + FRESH_MS).map((c) => c.working)).toEqual([false, false]);
    expect(withStatus(cards, record, 'someone', now).map((c) => c.working)).toEqual([false, false]);
  });
});

describe('readTeamStatus', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'team-status-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads each teammate card\'s thread and keeps what it read; a thread that fails keeps the old one', async () => {
    mkdirSync(join(dir, '.karajan'));
    writeFileSync(join(dir, '.karajan', 'team-status.json'), JSON.stringify({ 'HU-4': { state: 'working', at: 'old', by: 'jorge' } }));
    const team = [{ person: 'jorge', cards: [{ id: 'HU-3' }, { id: 'HU-4' }] }];
    const read = [];
    const inbox = async (cwd, issue) => { read.push(issue); if (issue === 4) throw new Error('quota'); return [msg({})]; };
    const warned = [];
    await readTeamStatus(dir, team, { inbox, log: { warn: (m) => warned.push(m) } });
    expect(read).toEqual([3, 4]);
    expect(warned).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, '.karajan', 'team-status.json'), 'utf8'))).toEqual({
      'HU-3': { state: 'working', at: '2026-11-12T10:00:00Z', by: 'jorge' },
      'HU-4': { state: 'working', at: 'old', by: 'jorge' },
    });
  });
});
