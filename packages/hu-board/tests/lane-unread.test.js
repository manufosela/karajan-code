// HU-4211: each lane of the stage shows how many unread link messages wait for it.
import { describe, expect, it } from 'vitest';
import { cachedUnread, laneUnreads, unreadFacts, unreadOf } from '../src/lane-unread.js';
import { laneStates } from '../src/stage-state.js';
import { laneStatuses, statusLine } from '../public/stage/lane-status.js';

const line = (thread, n) => JSON.stringify({ thread, messages: Array.from({ length: n }, (_, i) => ({ messageId: String(i) })), dropped: {} });

describe('unreadOf', () => {
  it('sums the messages of every thread and skips the ones that failed', () => {
    const out = [line('issue:1', 2), JSON.stringify({ thread: 'pr:2', error: 'boom' }), line('pr:3', 1), 'not json'].join('\n');
    expect(unreadOf(out)).toBe(3);
  });
  it('is 0 without threads', () => expect(unreadOf('')).toBe(0));
});

describe('unreadFacts', () => {
  it('reads the count through kj link inbox', async () => {
    await expect(unreadFacts('/lane', { run: async () => line('issue:1', 4) })).resolves.toBe(4);
  });
  it('is null when kj fails, never a zero', async () => {
    await expect(unreadFacts('/lane', { run: async () => { throw new Error('offline'); } })).resolves.toBeNull();
  });
});

describe('cachedUnread', () => {
  it('keeps a read for the ttl and shares it', () => {
    let reads = 0;
    const read = () => { reads += 1; return Promise.resolve(1); };
    expect(cachedUnread('/cached', { now: 1000, read })).toBe(cachedUnread('/cached', { now: 2000, read }));
    expect(reads).toBe(1);
    cachedUnread('/cached', { now: 1000 + 10 * 60 * 1000, read });
    expect(reads).toBe(2);
  });
});

describe('laneUnreads', () => {
  it('maps each lane dir of the project to its count', async () => {
    const reads = await laneUnreads('/nowhere', { lanes: [{ lane: 'main', dir: '/a' }, { lane: 'x', dir: '/b' }], read: async (d) => (d === '/a' ? 0 : 5) });
    expect(Object.fromEntries(reads)).toEqual({ '/a': 0, '/b': 5 });
  });
});

describe('the lane carries its unread count', () => {
  it('puts it on the lane and its status when a reader gave one', () => {
    const [main] = laneStates(process.cwd(), { readers: { unread: () => 3 }, branchOf: () => null });
    expect(main.unread).toBe(3);
    expect(main.status.unread).toBe(3);
  });
  it('leaves it out when nothing was read', () => {
    const [main] = laneStates(process.cwd(), { branchOf: () => null });
    expect(main.status.unread).toBeUndefined();
  });
  it('shows it in the line under the lane name, live too', () => {
    expect(statusLine({ state: 'idle', why: 'no activity', unread: 2 })).toBe('idle: no activity · 2 unread');
    expect(statusLine({ state: 'working', why: null, unread: 1 })).toBe('1 unread');
    const live = laneStatuses(['main'], { lanes: [{ lane: 'main', unread: 4 }] }, new Map());
    expect(live.get('main').unread).toBe(4);
  });
});
