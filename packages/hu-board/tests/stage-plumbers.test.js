// KJC-TSK-1642 (the maintainer, 2026-11-15): "a conveyor belt; if it fails it turns red and the gray
// robot comes to work on it until it works again". One plumber per lane whose pipeline failed: it
// teleports into the booth, walks round the workshops to behind its belt, works, and goes back.
import { describe, expect, it } from 'vitest';

import { BELT } from '../public/stage/conveyor.js';
import { WORKSHOP, boothAt, workshopAt } from '../public/stage/layout.js';
import { PLUMBER_GONE_MS, PLUMBER_IN_MS, plumberAt, plumberSpot, withPipelines } from '../public/stage/plumbers.js';
import { BUD_MS, HOST_WALK_MS } from '../public/stage/workers.js';

const lanes = ['main', 'a', 'b', 'c'];
const xOf = (lane) => workshopAt(lanes.indexOf(lane), lanes.length).x;
const zOf = (lane) => workshopAt(lanes.indexOf(lane), lanes.length).z;
const door = boothAt(lanes.length);
const pipes = (entries) => new Map(Object.entries(entries));

describe('withPipelines', () => {
  it('sends one plumber to each lane whose pipeline failed, and none twice', () => {
    let plumbers = withPipelines([], pipes({ main: 'running', a: 'failed', b: null }), 0);
    expect(plumbers).toEqual([{ lane: 'a', since: 0 }]);
    plumbers = withPipelines(plumbers, pipes({ a: 'failed' }), 5000);
    expect(plumbers).toEqual([{ lane: 'a', since: 0 }]);
  });

  it('once the pipeline runs or passes again it leaves; gone, it is forgotten', () => {
    let plumbers = withPipelines([], pipes({ a: 'failed', b: 'failed' }), 0);
    plumbers = withPipelines(plumbers, pipes({ a: 'running', b: 'passed' }), 10_000);
    expect(plumbers.map((p) => p.leftAt)).toEqual([10_000, 10_000]);
    expect(withPipelines(plumbers, pipes({}), 10_000 + PLUMBER_GONE_MS)).toEqual([]);
  });

  it('a lane that fails again while its plumber leaves gets a new one', () => {
    let plumbers = withPipelines([], pipes({ a: 'failed' }), 0);
    plumbers = withPipelines(plumbers, pipes({ a: 'running' }), 10_000);
    plumbers = withPipelines(plumbers, pipes({ a: 'failed' }), 11_000);
    expect(plumbers).toEqual([{ lane: 'a', since: 0, leftAt: 10_000 }, { lane: 'a', since: 11_000 }]);
  });
});

describe('plumberAt', () => {
  const spot = plumberSpot(xOf('c'), zOf('c'));
  const onPad = ({ x, z }) => lanes.some((lane) => Math.abs(x - xOf(lane)) < WORKSHOP.width / 2 - 0.2 && Math.abs(z - zOf(lane)) < WORKSHOP.depth / 2 - 0.2);

  it('stands behind its lane\'s belt, facing it, outside every workshop', () => {
    expect(spot.z).toBeLessThan(zOf('c') + BELT.z);
    expect(spot.x).toBeGreaterThan(xOf('c') + BELT.from);
    expect(spot.x).toBeLessThan(xOf('c') + BELT.to);
    expect(onPad(spot)).toBe(false);
  });

  it('teleports into the booth, walks round the workshops to its spot, and works there', () => {
    const p = { lane: 'c', since: 0 };
    expect(plumberAt(p, 0, xOf, zOf, door)).toMatchObject({ x: door.x, z: door.z, size: 0, working: false });
    for (let t = BUD_MS; t < PLUMBER_IN_MS; t += 50) expect(onPad(plumberAt(p, t, xOf, zOf, door)), `t=${t}`).toBe(false);
    const at = plumberAt(p, PLUMBER_IN_MS, xOf, zOf, door);
    expect(at).toMatchObject({ x: spot.x, z: spot.z, walking: false, working: true, yaw: 0 });
    expect(PLUMBER_IN_MS).toBe(BUD_MS + HOST_WALK_MS);
  });

  it('when it leaves it walks back to the booth and teleports out; then it is gone', () => {
    const p = { lane: 'c', since: 0, leftAt: 20_000 };
    expect(plumberAt(p, 20_000 + 10, xOf, zOf, door)).toMatchObject({ walking: true, working: false, size: 1 });
    expect(plumberAt(p, 20_000 + PLUMBER_GONE_MS, xOf, zOf, door)).toBeNull();
  });
});
