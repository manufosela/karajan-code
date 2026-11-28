// KJC-TSK-1836 (asked by the maintainer on 2026-11-28): "al pasar el ratón por encima de cada karajan,
// quiero que se muestre tooltip de qué es". Every figure that is Karajan (the conductor, kaRAGan,
// kaWATCHan and each piece in costume) answers the pointer with its name and what it does, from the
// legend, in the legend's language. Pure: workshop-pointer.js projects the boxes and shows the tip.
import { describe, expect, it } from 'vitest';

import { KARAJAN_FIGURES, figureBoxes, figureTip } from '../public/stage/karajan-tips.js';
import { CARDS } from '../public/stage/legend.js';
import { cardsIn } from '../public/stage/legend-es.js';
import { STATIONS } from '../public/stage/layout.js';

describe('the Karajan figures under the pointer', () => {
  it('knows every figure that is Karajan: the conductor, kaRAGan, kaWATCHan and every piece', () => {
    expect(KARAJAN_FIGURES).toEqual(['conductor', 'rag', 'watch', ...STATIONS]);
  });

  it('tells each one by its legend card, name first and what it does after, in English or Spanish', () => {
    for (const id of KARAJAN_FIGURES) {
      const en = CARDS.find((c) => c.id === id);
      const es = cardsIn('es').find((c) => c.id === id);
      expect(figureTip(id, 'en')).toEqual([en.name, en.does]);
      expect(figureTip(id, 'es')).toEqual([es.name, es.does]);
    }
    expect(figureTip('nobody', 'en')).toBeNull();
  });

  it('gives each figure a box around where it stands now, as tall as a figure, and none to a hidden one', () => {
    const [box] = figureBoxes([{ id: 'sentinel', x: 3, y: 1.8, z: -1, visible: true }]);
    expect(box.id).toBe('sentinel');
    expect(box.min.x).toBeLessThan(3);
    expect(box.max.x).toBeGreaterThan(3);
    expect(box.min.y).toBeCloseTo(1.8);
    expect(box.max.y - box.min.y).toBeGreaterThanOrEqual(1.2);
    expect(figureBoxes([{ id: 'tdd', x: 0, y: 0, z: 0, visible: false }])).toEqual([]);
  });

  // During reviews the stage shows one AI review figure per review, at each workshop (KJC-TSK-1595),
  // and hides the one at the post: every copy answers the pointer as the review.
  it('gives a box to every copy of a figure, each where it stands', () => {
    const boxes = figureBoxes([{ id: 'review', x: -5, y: 0, z: 2, visible: true }, { id: 'review', x: 9, y: 0, z: 2, visible: true }]);
    expect(boxes.map((b) => b.id)).toEqual(['review', 'review']);
    expect(boxes[1].min.x).toBeGreaterThan(boxes[0].max.x);
  });
});
