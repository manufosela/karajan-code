// KJC-TSK-1836: every figure that is Karajan answers the pointer with its legend card.
import { CARDS } from './legend.js';
import { cardsIn } from './legend-es.js';
import { STATIONS } from './hall-sizes.js';

export const KARAJAN_FIGURES = ['conductor', 'rag', 'watch', ...STATIONS];

/** Half the width and depth of a figure's box, and its height, in metres (the crew's scale). */
const HALF = 0.5;
const HEIGHT = 1.6;

/** [name, what it does] of figure `id` in `lang`; null when it is not a Karajan figure. */
export function figureTip(id, lang) {
  const card = (lang === 'es' ? cardsIn('es') : CARDS).find((c) => c.id === id);
  return card ? [card.name, card.does] : null;
}

/** A box about 1 m wide and deep, 1.6 m tall, on each visible `{ id, x, y, z }`. */
export const figureBoxes = (figures) => figures.filter((f) => f.visible).map(({ id, x, y, z }) => ({
  id,
  min: { x: x - HALF, y, z: z - HALF },
  max: { x: x + HALF, y: y + HEIGHT, z: z + HALF },
}));
