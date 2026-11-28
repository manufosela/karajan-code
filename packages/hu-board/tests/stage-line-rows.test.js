// KJC-TSK-1842 (the maintainer, 2026-11-28, with a sketch; ADR "kj stage en una línea", decision 4
// revised): two rows seen from the front. Behind, starting over the first workshop, Karajan's side with
// no gaps: booth, team, pieces, task wall, release table and mailbox. In front, the workshops, two
// wide at most, growing towards the camera row by row ("no quiero huecos... 2 de ancho máximo").
// Right of both, the warehouse and its crane.
import { describe, expect, it } from 'vitest';

import { lineGroups } from '../public/stage/line-layout.js';
import { viewCentre } from '../public/stage/layout.js';

const BACK = ['booth', 'team', 'pieces', 'wall', 'release', 'mailbox'];
const COUNTS = [1, 2, 5, 9];
const groupOf = (n, id) => lineGroups(n).find((g) => g.id === id);

describe('two rows seen from the front', () => {
  it('starts Karajan\'s row over the first workshop, at the lanes\' left edge', () => {
    for (const n of COUNTS) expect(groupOf(n, 'booth').from).toBeCloseTo(groupOf(n, 'lanes').from);
  });

  it('lays Karajan\'s row left to right in its order, with no gaps', () => {
    for (const n of COUNTS) {
      const back = BACK.map((id) => groupOf(n, id));
      for (const g of back) expect(g.to).toBeGreaterThan(g.from);
      for (const [a, b] of back.slice(1).map((g, i) => [back[i], g])) expect(b.from - a.to).toBeCloseTo(0);
    }
  });

  it('keeps Karajan\'s row where it is whatever the number of lanes', () => {
    for (const id of BACK) for (const n of COUNTS) expect(groupOf(n, id).from).toBeCloseTo(groupOf(1, id).from);
  });

  it('puts the warehouse right of both rows', () => {
    for (const n of COUNTS) {
      const end = Math.max(groupOf(n, 'lanes').to, groupOf(n, 'mailbox').to);
      expect(groupOf(n, 'warehouse').from).toBeGreaterThanOrEqual(end);
    }
  });

  it('looks at the middle of both rows, the warehouse left for the drag', () => {
    for (const n of COUNTS) {
      const lanes = groupOf(n, 'lanes');
      expect(viewCentre(n)).toBeCloseTo((lanes.from + Math.max(lanes.to, groupOf(n, 'mailbox').to)) / 2);
    }
  });
});
