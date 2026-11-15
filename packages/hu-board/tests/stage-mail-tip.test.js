// KJC-TSK-1638 (the maintainer, 2026-11-15): "why does the mailbox blink if I see nothing to do in
// the karajan session? Can a tooltip say what I have to do?". Over the mailbox, what waits for the
// human, in which lane and since when; a click lists them all.
import { describe, expect, it } from 'vitest';

import { thingBoxes, thingTip } from '../public/stage/hall-things.js';
import { mailboxSpot } from '../public/stage/layout.js';
import { ago, mailRows, mailTip } from '../public/stage/mail-tip.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const letter = (id, lane, why, minutes, command = null) => ({ id, lane, kind: 'task', why, command, since: new Date(NOW - minutes * 60_000).toISOString() });

describe('ago', () => {
  it('says how long it has waited, in the largest whole unit', () => {
    expect(ago(new Date(NOW - 20_000).toISOString(), NOW)).toBe('just now');
    expect(ago(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 min ago');
    expect(ago(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3 h ago');
    expect(ago(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2 d ago');
    expect(ago(null, NOW)).toBe('');
  });
});

describe('the mailbox under the pointer', () => {
  it('is one of the hall\'s things, its box around the mailbox where the hall puts it', () => {
    const at = mailboxSpot(3);
    const box = thingBoxes(0, at).find((b) => b.id === 'mailbox');
    expect(box.min.x).toBeLessThan(at.x);
    expect(box.max.x).toBeGreaterThan(at.x);
    expect(box.min.z).toBeLessThan(at.z);
    expect(box.max.y).toBeGreaterThan(1.5);
    expect(thingBoxes(0).map((b) => b.id)).not.toContain('mailbox');
  });

  it('says nothing waits when it is empty', () => {
    expect(mailTip([], NOW)).toEqual(['Mailbox', 'Nothing waits for you.']);
  });

  it('says how many wait and what the oldest ask, with their lane and since when, and that a click lists them', () => {
    const letters = [letter('a', 'main', 'Seal the release', 90), letter('b', 'HU-1', null, 5, 'kj rules approve'), letter('c', 'x', 'Approve', 2), letter('d', 'y', 'Sign', 1)];
    expect(mailTip(letters, NOW)).toEqual([
      'Mailbox · 4 things only you can do',
      'main · Seal the release · 1 h ago',
      'HU-1 · kj rules approve · 5 min ago',
      'x · Approve · 2 min ago',
      '…and 1 more. Click to see them all',
    ]);
    expect(thingTip('mailbox', { letters: letters.slice(0, 1), now: NOW }).at(-1)).toBe('Click to see them all');
  });
});

describe('mailRows', () => {
  it('every letter for the list: its lane, what to do, the command to type and since when', () => {
    expect(mailRows([letter('a', 'main', 'Seal the release', 90, 'kj harden --commit'), letter('b', 'x', null, 5)], NOW)).toEqual([
      { id: 'a', lane: 'main', what: 'Seal the release', command: 'kj harden --commit', since: '1 h ago', denial: false },
      { id: 'b', lane: 'x', what: 'A handoff', command: null, since: '5 min ago', denial: false },
    ]);
  });
});
