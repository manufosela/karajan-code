// KJC-TSK-1699 (the maintainer, 2026-11-19): a host inside one long tool stays in its workshop,
// marked long; the board says which on each resync, and its next beat clears the mark.
import { describe, expect, it } from 'vitest';

import { withActivity, withLongRuns, workersFrom } from '../public/stage/workers.js';

const host = { agent: 'claude', role: 'host', id: 's1', tool: 'Bash' };
const start = { type: 'agent-activity', agent: 'claude', role: 'host', phase: 'start', id: 's1', lane: 'a', tool: 'Read' };

describe('long runs', () => {
  it('a host the stage opens on in a long tool keeps the mark', () => {
    expect(workersFrom([{ ...host, long: true }], 0, 'a')[0].long).toBe(true);
    expect(workersFrom([host], 0, 'a')[0]).not.toHaveProperty('long');
  });

  it('the board marks and unmarks each host by lane and id', () => {
    const workers = workersFrom([host], 0, 'a');
    const marked = withLongRuns(workers, [{ ...host, lane: 'a', long: true }]);
    expect(marked[0].long).toBe(true);
    expect(withLongRuns(marked, [{ ...host, lane: 'a' }])[0]).not.toHaveProperty('long');
    expect(withLongRuns(workers, [{ ...host, lane: 'b', long: true }])[0]).not.toHaveProperty('long');
  });

  it('its next beat clears the mark', () => {
    const marked = workersFrom([{ ...host, long: true }], 0, 'a');
    expect(withActivity(marked, start, 1)[0]).not.toHaveProperty('long');
  });
});
