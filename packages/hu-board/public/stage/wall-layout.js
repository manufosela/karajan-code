// KJC-TSK-1459 (ADR 0050): what the factory's task board wall shows. Pure: three
// columns, each with its newest cards that fit and how many more there are.
import { columnOf } from './cards.js';

export const WALL_ROWS = 6;
const COLUMNS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];

/** The wall's columns from the factory's cards: `{ title, cards: [{ id, title }], more }`. */
export function wallColumns(cards) {
  return COLUMNS.map(([column, title]) => {
    const here = cards.filter((c) => columnOf(c.status) === column).toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { title, cards: here.slice(0, WALL_ROWS).map((c) => ({ id: c.id, title: c.title ?? '' })), more: Math.max(0, here.length - WALL_ROWS) };
  });
}
