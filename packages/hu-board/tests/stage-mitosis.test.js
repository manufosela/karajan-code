// KJC-TSK-1611 (the maintainer, 2026-11-13): the agents Karajan launches come out of it, as a cell
// divides, and melt back into it when they end; they no longer walk in and out by the back door.
// The host, whose session the person opens, still uses the door; a subagent, its host.
import { describe, expect, it } from 'vitest';

import { CREW } from '../public/stage/layout.js';
import { BUD_MS, DOOR, WALK_MS, spotOf, withActivity, workerAt } from '../public/stage/workers.js';

const start = (role, agent = 'codex') => ({ type: 'agent-activity', agent, role, phase: 'start', lane: 'main' });
const end = (role, agent = 'codex') => ({ type: 'agent-activity', agent, role, phase: 'end', lane: 'main' });
const KARAJAN = { x: CREW.conductor.x, z: CREW.conductor.z };

describe('mitosis', () => {
  it('an agent Karajan launches buds from it, growing, and walks to its desk', () => {
    const [w] = withActivity([], start('coder'), 0);
    expect(workerAt(w, 0)).toMatchObject({ ...KARAJAN, walking: true, size: 0 });
    expect(workerAt(w, BUD_MS / 2).size).toBeCloseTo(0.5);
    expect(workerAt(w, BUD_MS).size).toBe(1);
    expect(workerAt(w, WALK_MS)).toMatchObject({ ...spotOf('coder'), walking: false, size: 1 });
  });

  it('when it ends it walks back to Karajan and shrinks into it', () => {
    let workers = withActivity([], start('solomon', 'agy'), 0);
    workers = withActivity(workers, end('solomon', 'agy'), 10_000);
    const almost = workerAt(workers[0], 10_000 + WALK_MS - 1);
    expect(almost.size).toBeLessThan(0.01);
    expect(almost.x).toBeCloseTo(KARAJAN.x, 1);
    expect(workerAt(workers[0], 10_000 + WALK_MS)).toBeNull();
  });

  it('the host still comes in by the door, full size', () => {
    const [w] = withActivity([], { ...start('host', 'claude'), id: 's1' }, 0);
    expect(workerAt(w, 0)).toMatchObject({ x: DOOR.x, z: DOOR.z });
    expect(workerAt(w, 0).size).toBe(1);
  });
});
