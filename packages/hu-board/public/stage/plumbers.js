// KJC-TSK-1642 (asked by the maintainer on 2026-11-15): "a conveyor belt; if it fails it turns red
// and the gray robot comes to work on it until it works again". One plumber per lane whose pipeline
// failed (conveyor.js): it teleports into the booth, walks round the workshops to behind its belt,
// works there and, once the pipeline runs or passes again, walks back and teleports out, as a host
// does (workers.js hostAt). Pure: plumbers-floor.js draws them.
import { BELT } from './conveyor.js';
import { BUD_MS, HOST_WALK_MS, hostAt } from './workers.js';

/** How long from its start until it works at its belt, and from its leaving until it is gone. */
export const PLUMBER_IN_MS = BUD_MS + HOST_WALK_MS;
export const PLUMBER_GONE_MS = HOST_WALK_MS + BUD_MS;

/** Where it works: behind its lane's belt, near its left end, facing it. */
export const plumberSpot = (laneX, laneZ) => ({ x: laneX + BELT.from + 1.2, z: laneZ + BELT.z - 0.6 });

/** From the booth out to the left of every workshop, along behind the row, and in to its spot. */
const wayTo = (door, spot) => {
  const edgeX = door.edgeX ?? door.x;
  return [{ x: door.x, z: door.z }, { x: edgeX, z: door.z }, { x: edgeX, z: spot.z }, spot];
};

/**
 * The plumbers after the lanes' `pipelines` (lane → pipeline) at `now`: a new one for a failed
 * lane with none at work, leaving for one whose lane no longer fails, forgotten once gone.
 */
export function withPipelines(plumbers, pipelines, now) {
  const kept = plumbers
    .filter((p) => p.leftAt === undefined || now < p.leftAt + PLUMBER_GONE_MS)
    .map((p) => (p.leftAt === undefined && pipelines.get(p.lane) !== 'failed' ? { ...p, leftAt: now } : p));
  const atWork = new Set(kept.filter((p) => p.leftAt === undefined).map((p) => p.lane));
  const called = [...pipelines].filter(([lane, pipeline]) => pipeline === 'failed' && !atWork.has(lane)).map(([lane]) => ({ lane, since: now }));
  const next = [...kept, ...called];
  return next.length === plumbers.length && next.every((p, i) => p === plumbers[i]) ? plumbers : next;
}

/** Where a plumber is at `now`, and whether it works at its belt; null once gone. */
export function plumberAt(plumber, now, xOf, zOf, door) {
  const spot = plumberSpot(xOf(plumber.lane), zOf(plumber.lane));
  const pose = hostAt(plumber, now, spot, wayTo(door, spot));
  if (!pose) return null;
  const working = plumber.leftAt === undefined && now - plumber.since >= PLUMBER_IN_MS;
  return { ...pose, working };
}
