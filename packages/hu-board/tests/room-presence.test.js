// KJC-TSK-1573 (ADR 0056): who else is in the room. The board keeps its presence there and tells
// its live peers apart from those it has not seen for a while.
import { describe, expect, it } from 'vitest';

import { livePeers } from '../src/room/presence.js';

describe('livePeers', () => {
  it('is everyone but me seen in the last 90 s, in order', () => {
    const now = 1_000_000;
    const presence = { manufosela: now, jorgecasar: now - 30_000, aitor: now - 91_000, joan: now - 5_000, odd: 'x' };
    expect(livePeers(presence, 'manufosela', now)).toEqual(['joan', 'jorgecasar']);
  });

  it('allows a clock a little behind the server, not one far ahead', () => {
    const now = 1_000_000;
    expect(livePeers({ a: now + 20_000, b: now + 600_000 }, 'me', now)).toEqual(['a']);
  });
});
