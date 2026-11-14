// KJC-TSK-1459 (ADR 0050): what the factory's task board wall shows. Pure: three
// columns, each with its newest cards that fit and how many more there are.
import { columnOf } from './cards.js';

export const WALL_ROWS = 6;
const COLUMNS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];

/** KJC-TSK-1627: every card of each column, the newest first: `{ title, cards: [{ id, title }] }`. */
export const wallLists = (cards) => COLUMNS.map(([column, title]) => ({
  title,
  cards: cards.filter((c) => columnOf(c.status) === column).toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((c) => ({ id: c.id, title: c.title ?? '' })),
}));

/** The wall's columns from the factory's cards: `{ title, cards: [{ id, title }], more }`. */
export function wallColumns(cards) {
  return wallLists(cards).map(({ title, cards: here }) => ({ title, cards: here.slice(0, WALL_ROWS), more: Math.max(0, here.length - WALL_ROWS) }));
}
