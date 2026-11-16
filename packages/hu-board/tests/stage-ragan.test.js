// KJC-TSK-1438 (ADR 0048): kaRAGan takes the RAG's answer to the agent of the lane that asked.
import { describe, expect, it } from 'vitest';

import { CREW, WORKSHOP } from '../public/stage/layout.js';
import { HAND_MS, INDEX_MAX_MS, RAGAN_WALK_MS, raganAt, withIndex, withRag } from '../public/stage/ragan.js';
import { restState, withEvent } from '../public/stage/rest.js';
import { spotOf } from '../public/stage/workers.js';

const xOf = (lane) => ({ main: -6, 'kj-stage': 6 })[lane] ?? 0;
const answer = (lane, sources = 3) => ({ type: 'rag-answer', lane, sources, at: '2026-11-05T10:00:00Z' });

/**
 * KJC-BUG-0616 (the maintainer, 2026-11-16, with a picture of HU-4424): it typed right behind the host
 * and, the host being big, covered it from the camera. Beside the host's seat, level with it, facing
 * it, and saying it is out of its post (its name goes over it), never behind it.
 */
function besideTheHost(pose, lane) {
  const host = spotOf('host', xOf(lane), undefined, WORKSHOP.z);
  expect(Math.abs(pose.z - host.z)).toBeLessThan(0.3);
  expect(host.x - pose.x).toBeGreaterThanOrEqual(1.2);
  expect(host.x - pose.x).toBeLessThan(WORKSHOP.width / 2);
  expect(pose.yaw).toBeCloseTo(Math.PI / 2);
  expect(pose.away).toBe(true);
}

describe('kaRAGan at work', () => {
  it('waits at its post until the RAG answers', () => {
    expect(raganAt(null, 0, xOf)).toMatchObject({ x: CREW.rag.x, z: CREW.rag.z, walking: false });
    expect(raganAt(null, 0, xOf).away).toBeFalsy(); // at its post it needs no name over it
    expect(withRag(null, { type: 'review-verdict' }, 0)).toBeNull();
  });

  it('walks the answer to the lane that asked, hands it over, and walks back to its post', () => {
    const rag = withRag(null, answer('kj-stage'), 1000);
    expect(raganAt(rag, 1000 + RAGAN_WALK_MS / 2, xOf).walking).toBe(true);
    const there = raganAt(rag, 1000 + RAGAN_WALK_MS + HAND_MS / 2, xOf);
    expect(there.walking).toBe(false);
    besideTheHost(there, 'kj-stage');
    expect(raganAt(rag, 1000 + 2 * RAGAN_WALK_MS + HAND_MS, xOf)).toMatchObject({ x: CREW.rag.x, z: CREW.rag.z, walking: false });
  });

  it('the status list tells how many sources it answered with, and where', () => {
    const state = withEvent({}, answer('kj-stage', 4));
    expect(restState(state, Date.parse('2026-11-05T10:00:30Z')).lines).toEqual(['kaRAGan: answered with 4 sources in kj-stage, just now']);
  });
});

// KJC-TSK-1522 (decided by the maintainer on 2026-11-11): while the RAG reindexes a lane,
// kaRAGan goes to its workshop and types on a laptop until the reindex ends.
describe('kaRAGan reindexing', () => {
  const index = (phase, lane = 'kj-stage') => ({ type: 'rag-index', phase, lane, at: '2026-11-11T10:00:00Z' });
  const start = withIndex(null, index('start'), 1000);

  it('walks to the lane, then types there for as long as the reindex lasts', () => {
    expect(withIndex(null, { type: 'rag-answer' }, 0)).toBeNull();
    expect(raganAt(null, 1000 + RAGAN_WALK_MS / 2, xOf, undefined, start)).toMatchObject({ walking: true, typing: false });
    const there = raganAt(null, 1000 + RAGAN_WALK_MS + 60_000, xOf, undefined, start);
    expect(there).toMatchObject({ walking: false, typing: true, since: 1000 + RAGAN_WALK_MS });
    besideTheHost(there, 'kj-stage');
  });

  it('when it ends it puts the laptop away and walks back to its post, over an answer trip', () => {
    const done = withIndex(start, index('end'), 90_000);
    expect(withIndex(start, index('end', 'main'), 90_000)).toBe(start);
    expect(raganAt(null, 90_000 + RAGAN_WALK_MS / 2, xOf, undefined, done)).toMatchObject({ walking: true, typing: false });
    const answering = withRag(null, answer('main'), 90_000);
    const back = 90_000 + RAGAN_WALK_MS / 2;
    expect(raganAt(answering, back, xOf, undefined, done)).toEqual(raganAt(null, back, xOf, undefined, done));
    expect(raganAt(null, 90_000 + RAGAN_WALK_MS, xOf, undefined, done)).toMatchObject({ x: CREW.rag.x, z: CREW.rag.z, walking: false });
  });

  it('goes back on its own when no end comes', () => {
    expect(raganAt(null, 1000 + INDEX_MAX_MS + RAGAN_WALK_MS, xOf, undefined, start)).toMatchObject({ x: CREW.rag.x, z: CREW.rag.z, walking: false });
  });

  // KJC-TSK-1630 (the maintainer, 2026-11-14): "I only see the agent waiting; if the RAG is querying,
  // shouldn't it move?" A query in progress keeps kaRAGan typing at the lane until its answer comes.
  it('a query in progress: it walks to the lane and types there until that lane\'s answer, with no second trip', () => {
    const query = withIndex(null, { type: 'rag-query', phase: 'start', lane: 'kj-stage', at: '2026-11-14T10:00:00Z' }, 1000);
    expect(query).toMatchObject({ lane: 'kj-stage', at: 1000, end: null, query: true });
    expect(raganAt(null, 1000 + RAGAN_WALK_MS + 5000, xOf, undefined, query)).toMatchObject({ walking: false, typing: true });
    expect(withIndex(query, answer('main'), 9000)).toBe(query); // another lane's answer does not end it
    const answered = withIndex(query, answer('kj-stage'), 9000);
    expect(answered.end).toBe(9000);
    expect(withRag(null, answer('kj-stage'), 9000, query)).toBeNull(); // it is there already
    expect(withRag(null, answer('main'), 9000, query)).toEqual({ lane: 'main', at: 9000 });
    expect(raganAt(null, 9000 + RAGAN_WALK_MS, xOf, undefined, answered)).toMatchObject({ x: CREW.rag.x, z: CREW.rag.z, walking: false });
  });

  it('the stage takes a query start as an event of its own', () => {
    const event = { type: 'rag-query', phase: 'start', lane: 'kj-stage', at: '2026-11-14T10:00:00Z' };
    expect(withEvent({}, event)).not.toEqual({});
  });

  it('the status list says it reindexes, and where', () => {
    const state = withEvent({}, index('start'));
    expect(restState(state, Date.parse('2026-11-11T10:00:30Z')).lines).toEqual(['kaRAGan: reindexing in kj-stage, since just now']);
    expect(restState(withEvent(state, index('end')), Date.parse('2026-11-11T10:00:30Z')).lines).toEqual(['kaRAGan: reindexed in kj-stage, just now']);
  });
});
