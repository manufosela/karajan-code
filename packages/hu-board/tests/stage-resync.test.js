// KJC-BUG-0557: the scene only let a robot go when its end event came, and a session that dies
// says nothing; the hall only ever added workshops. Every minute the scene checks itself against
// the board's state: who the board no longer sees at work walks out, and a lane that is gone goes.
import { describe, expect, it } from 'vitest';

import { goneLanes, staleEnds } from '../public/stage/resync.js';

const host = (lane, id) => ({ agent: 'claude', role: 'host', lane, id });
const coder = (lane) => ({ agent: 'claude', role: 'coder', lane, id: null });

describe('staleEnds', () => {
  it('ends everyone at work here that the board no longer sees, and nobody it still sees', () => {
    const local = [host('a', 's1'), host('a', 's2'), coder('b'), host('main', 's3')];
    const server = [host('a', 's1'), { ...coder('b'), id: undefined }];
    expect(staleEnds(local, server, 't')).toEqual([
      { type: 'agent-activity', phase: 'end', agent: 'claude', role: 'host', lane: 'a', id: 's2', at: 't' },
      { type: 'agent-activity', phase: 'end', agent: 'claude', role: 'host', lane: 'main', id: 's3', at: 't' },
    ]);
  });

  it('tells apart the same session in two lanes, and takes a missing lane as main', () => {
    expect(staleEnds([host('a', 's1')], [{ ...host(undefined, 's1') }], 't')).toHaveLength(1);
    expect(staleEnds([host(undefined, 's1')], [host('main', 's1')], 't')).toEqual([]);
  });
});

describe('goneLanes', () => {
  it('is the lanes the board no longer lists, never the main checkout', () => {
    expect(goneLanes(['main', 'a', 'b', 'c'], [{ lane: 'main' }, { lane: 'b' }], [])).toEqual(['a', 'c']);
  });

  it('keeps a lane while a robot still works in it', () => {
    expect(goneLanes(['main', 'a'], [{ lane: 'main' }], [host('a', 's1')])).toEqual([]);
  });
});
