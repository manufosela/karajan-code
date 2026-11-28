// KJC-TSK-1829 (ADR "kj stage en una línea", accepted 2026-11-27): after the lanes, in that order on
// the line, the task wall, then the "Ready to release" table with its version counter and kaWATCHan.
// They stand in their stretch of the line for the lanes there are, and move with it; whatever goes to
// them (the wall drone, the release drone, kaWATCHan's walk) goes to where they are.
import { describe, expect, it } from 'vitest';

import { LINE, lineGroups } from '../public/stage/line-layout.js';
import { hallSpan, releaseAt, versionAt, viewCentre, wallAt, watchAt } from '../public/stage/layout.js';
import { packLots } from '../public/stage/map-layout.js';
import { DOCK_ABOVE, dockAt } from '../public/stage/wall-drone.js';
import { droneAt, releaseFlight, watcherAt } from '../public/stage/drone.js';

const COUNTS = [1, 2, 4, 7, 12];
const stretch = (n, id) => lineGroups(n).find((g) => g.id === id);
const inside = (x, n, id) => {
  expect(x).toBeGreaterThanOrEqual(stretch(n, id).from);
  expect(x).toBeLessThanOrEqual(stretch(n, id).to);
};

describe('the right of the line', () => {
  it('stands the task wall in its stretch, right after the lanes, on the line', () => {
    for (const n of COUNTS) {
      const wall = wallAt(n);
      inside(wall.x - wall.width / 2, n, 'wall');
      inside(wall.x + wall.width / 2, n, 'wall');
      expect(Math.abs(wall.z - LINE.z)).toBeLessThanOrEqual(0.5);
    }
  });

  it('stands the release table, the version counter and kaWATCHan in the release stretch, in that order', () => {
    for (const n of COUNTS) {
      const xs = [releaseAt(n).x, versionAt(n).x, watchAt(n).x];
      for (const x of xs) inside(x, n, 'release');
      expect(xs[1]).toBeGreaterThan(xs[0]);
      for (const z of [releaseAt(n).z, versionAt(n).z, watchAt(n).z]) expect(Math.abs(z - LINE.z)).toBeLessThanOrEqual(0.8);
    }
  });

  it('moves them all right as lanes come, by exactly the lanes added', () => {
    const pitch = stretch(2, 'lanes').to - stretch(1, 'lanes').to;
    expect(wallAt(2).x - wallAt(1).x).toBeCloseTo(pitch);
    expect(releaseAt(2).x - releaseAt(1).x).toBeCloseTo(pitch);
    expect(watchAt(2).x - watchAt(1).x).toBeCloseTo(pitch);
  });

  // #5037 (codex): with many lanes the wall and the release stretch stood past the map's lot and the
  // drag's reach. Both reach the whole line, from the booth to its last stretch.
  it('lets the map lot and the drag reach the whole line, its right end included', () => {
    for (const n of COUNTS) {
      const groups = lineGroups(n);
      const [start, end] = [groups[0].from, groups.at(-1).to];
      const lot = packLots([n]).lots[0];
      expect(lot.width / 2).toBeGreaterThanOrEqual(Math.max(Math.abs(start), Math.abs(end)));
      const half = hallSpan(n).width / 2;
      expect(viewCentre(n) - half).toBeLessThanOrEqual(start);
      expect(viewCentre(n) + half).toBeGreaterThanOrEqual(end);
    }
  });

  it('docks the wall drone over the wall where the wall is', () => {
    for (const n of COUNTS) {
      expect(dockAt(n).x).toBeCloseTo(wallAt(n).x);
      expect(dockAt(n).y).toBeCloseTo(wallAt(n).y + wallAt(n).height + DOCK_ABOVE);
    }
  });

  it('sends the release drone to the table and kaWATCHan to the counter, where they are', () => {
    for (const n of [1, 7]) {
      const flight = releaseFlight('1.0.0', '1.1.0', [], 0);
      const over = Array.from({ length: 400 }, (_, i) => droneAt(flight, i * 20, n)).filter(Boolean);
      expect(over.some((p) => Math.abs(p.x - releaseAt(n).x) < 0.2 && Math.abs(p.z - releaseAt(n).z) < 0.2)).toBe(true);
      const walk = Array.from({ length: 800 }, (_, i) => watcherAt(flight, i * 20, n));
      expect(walk[0]).toMatchObject({ x: watchAt(n).x, z: watchAt(n).z });
      expect(walk.some((p) => Math.abs(p.x - versionAt(n).x) < 1)).toBe(true);
    }
  });
});
