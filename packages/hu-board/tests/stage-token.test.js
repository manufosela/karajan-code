// KJC-BUG-0492: off loopback the board asks for its token; the stage page passes it
// like the RAG and Wiki pages do (from ?token= or the one the board pages stored).
import { describe, expect, it } from 'vitest';

import { boardToken, withToken } from '../public/stage/token.js';

const store = (value) => () => ({ getItem: (k) => (k === 'kj_board_token' ? value : null) });

describe('boardToken', () => {
  it('takes the token from the page address first, then the stored one, else none', () => {
    expect(boardToken('?project=p&token=abc', store('stored'))).toBe('abc');
    expect(boardToken('?project=p', store('stored'))).toBe('stored');
    expect(boardToken('?project=p', store(null))).toBe('');
  });

  it('a storage that cannot be read gives no token instead of breaking the page', () => {
    expect(boardToken('?project=p', () => { throw new Error('denied'); })).toBe('');
  });
});

describe('withToken', () => {
  it('adds the token to a URL that has a query, and leaves it alone without a token', () => {
    expect(withToken('/api/events?project=p', 'a b')).toBe('/api/events?project=p&token=a%20b');
    expect(withToken('/api/events?project=p', '')).toBe('/api/events?project=p');
  });
});
