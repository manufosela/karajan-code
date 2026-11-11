// KJC-TSK-1438 (ADR 0048): kaRAGan takes the RAG's answer to the agent of the lane that asked.
import { describe, expect, it } from 'vitest';

import { CREW } from '../public/stage/layout.js';
import { HAND_MS, INDEX_MAX_MS, RAGAN_WALK_MS, raganAt, withIndex, withRag } from '../public/stage/ragan.js';
import { restState, withEvent } from '../public/stage/rest.js';

const xOf = (lane) => ({ main: -6, 'kj-stage': 6 })[lane] ?? 0;
const answer = (lane, sources = 3) => ({ type: 'rag-answer', lane, sources, at: '2026-11-05T10:00:00Z' });

describe('kaRAGan at work', () => {
  it('waits at its post until the RAG answers', () => {
    expect(raganAt(null, 0, xOf)).toMatchObject({ x: CREW.rag.x, z: CREW.rag.z, walking: false });
    expect(withRag(null, { type: 'review-verdict' }, 0)).toBeNull();
  });

  it('walks the answer to the lane that asked, hands it over, and walks back to its post', () => {
    const rag = withRag(null, answer('kj-stage'), 1000);
    expect(raganAt(rag, 1000 + RAGAN_WALK_MS / 2, xOf).walking).toBe(true);
    const there = raganAt(rag, 1000 + RAGAN_WALK_MS + HAND_MS / 2, xOf);
    expect(there.walking).toBe(false);
    expect(Math.abs(there.x - xOf('kj-stage'))).toBeLessThan(2);
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
    expect(Math.abs(there.x - xOf('kj-stage'))).toBeLessThan(2);
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

  it('the status list says it reindexes, and where', () => {
    const state = withEvent({}, index('start'));
    expect(restState(state, Date.parse('2026-11-11T10:00:30Z')).lines).toEqual(['kaRAGan: reindexing in kj-stage, since just now']);
    expect(restState(withEvent(state, index('end')), Date.parse('2026-11-11T10:00:30Z')).lines).toEqual(['kaRAGan: reindexed in kj-stage, just now']);
  });
});
