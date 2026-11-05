// KJC-TSK-1438 (ADR 0048): kaRAGan takes the RAG's answer to the agent of the lane that asked.
import { describe, expect, it } from 'vitest';

import { CREW } from '../public/stage/layout.js';
import { HAND_MS, RAGAN_WALK_MS, raganAt, withRag } from '../public/stage/ragan.js';
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
