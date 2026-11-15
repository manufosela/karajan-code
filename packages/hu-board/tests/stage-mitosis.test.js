// KJC-TSK-1611 (the maintainer, 2026-11-13): the agents Karajan launches come out of it, as a cell
// divides, and melt back into it when they end; they no longer walk in and out by the back door.
// A subagent does so with its host; the host, whose session the person opens, by the side door.
import { describe, expect, it } from 'vitest';

import { CREW, POST, POSTS, STAND, WORKSHOP, boothAt, postX, workshopAt } from '../public/stage/layout.js';
import { BUD_MS, HOST_WALK_MS, READER, WALK_MS, spotOf, withActivity, workerAt } from '../public/stage/workers.js';

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

  // KJC-TSK-1628 (the maintainer, 2026-11-14): "the bots go behind the Sentinel… not walking over
  // everyone… it goes back where it came from and melts beside it". KJC-TSK-1632 (2026-11-15):
  // "better a booth, beside the orchestrator agent by atril".
  describe('the host and the booth', () => {
    const lanes = ['main', 'HU-1-a', 'HU-2-b', 'HU-3-c'];
    const xOf = (lane) => workshopAt(lanes.indexOf(lane), lanes.length).x;
    const zOf = (lane) => workshopAt(lanes.indexOf(lane), lanes.length).z;
    const door = boothAt(lanes.length);
    const host = (lane) => withActivity([], { ...start('host', 'claude'), lane, id: 's1' }, 0)[0];
    /** Whether a point stands on a workshop's pad (its plate in front is floor anyone walks). */
    const onPad = ({ x, z }) => lanes.some((lane) => Math.abs(x - xOf(lane)) < WORKSHOP.width / 2 - 0.2 && Math.abs(z - zOf(lane)) < WORKSHOP.depth / 2 - 0.2);

    // KJC-TSK-1636 (2026-11-15): "the booth hides atril; beside it, to the right of the agent by atril,
    // with room enough".
    it('the booth stands to the right of Karajan, with room around it, clear of atril, wherever the workshops are', () => {
      const room = (p) => Math.hypot(door.x - p.x, door.z - p.z);
      expect(door.x).toBeGreaterThan(CREW.conductor.x);
      expect(room(CREW.conductor)).toBeLessThan(2.5);
      for (const near of [CREW.conductor, { x: postX(POSTS[0]), z: POST.z }, STAND, READER]) expect(room(near)).toBeGreaterThan(1.5);
      expect(door.z + 0.9).toBeLessThan(WORKSHOP.z - WORKSHOP.depth / 2); // in front of it, the first row's back
      expect(boothAt(8)).toMatchObject({ x: door.x, z: door.z });
      // The way out runs left of every workshop, wider as the hall grows.
      expect(door.edgeX).toBeLessThan(xOf('main') - WORKSHOP.width / 2);
      expect(boothAt(8).edgeX).toBeLessThan(boothAt(2).edgeX);
    });

    it('comes out of the booth, budding beside it, round the workshops and along the aisle to its desk, over no workshop', () => {
      const w = host('HU-3-c');
      expect(workerAt(w, 0, xOf, zOf, door)).toMatchObject({ x: door.x, z: door.z, size: 0 });
      expect(workerAt(w, BUD_MS, xOf, zOf, door).size).toBe(1);
      for (let t = 0; t < HOST_WALK_MS; t += 50) {
        const at = workerAt(w, t, xOf, zOf, door);
        const spot = spotOf('host', xOf('HU-3-c'), undefined, zOf('HU-3-c'));
        if (Math.hypot(at.x - spot.x, at.z - spot.z) > WORKSHOP.depth) expect(onPad(at), `t=${t}`).toBe(false);
      }
      expect(workerAt(w, HOST_WALK_MS, xOf, zOf, door)).toMatchObject({ ...spotOf('host', xOf('HU-3-c'), undefined, zOf('HU-3-c')), walking: false });
    });

    it('when its session ends it walks back the same way and melts in the booth', () => {
      const [w] = withActivity([host('HU-2-b')], { ...end('host', 'claude'), lane: 'HU-2-b', id: 's1' }, 10_000);
      const almost = workerAt(w, 10_000 + HOST_WALK_MS - 1, xOf, zOf, door);
      expect(almost.size).toBeLessThan(0.01);
      expect(almost.x).toBeCloseTo(door.x, 1);
      expect(almost.z).toBeCloseTo(door.z, 1);
      expect(workerAt(w, 10_000 + HOST_WALK_MS, xOf, zOf, door)).toBeNull();
    });
  });
});
