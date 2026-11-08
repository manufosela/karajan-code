// KJC-TSK-1458 (ADR 0050): the factory's task board, folded from the card trace that
// kj hu add and kj hu move leave in each lane. Pure, so the board (to open on the
// last state) and the scene (live) fold it the same way.

const COLUMNS = { pending: 'todo', running: 'doing', done: 'done' };

/** The wall's column of a card's status; failed and skipped cards leave the wall. */
export const columnOf = (status) => COLUMNS[status] ?? null;

/** The cards after a `card` event: the last line of each card decides where it is. */
export function withCard(cards, event) {
  // A move queued without network has not happened yet.
  if (event?.type !== 'card' || event.queued) return cards;
  const before = cards.find((c) => c.id === event.id);
  const now = { id: event.id, title: event.title ?? before?.title ?? null, status: event.status, lane: event.lane ?? before?.lane ?? 'main', at: event.at };
  return [...cards.filter((c) => c.id !== event.id), now];
}

/** One board from the cards of every lane: a card that went through several keeps its newest line. */
export function mergeCards(lists) {
  const byId = new Map();
  for (const c of lists.flat().toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    byId.set(c.id, { ...c, title: c.title ?? byId.get(c.id)?.title ?? null });
  }
  return [...byId.values()];
}

/** KJC-TSK-1460 (ADR 0050, point 6): a factory's name on the map, with its cards in progress when it has any. */
export function mapName(project, cards) {
  const doing = cards.filter((c) => columnOf(c.status) === 'doing').length;
  return doing ? `${project} · ${doing} in progress` : project;
}

/** The status list's line for the board, or null when it holds no card. */
export function boardLine(cards) {
  const count = (column) => cards.filter((c) => columnOf(c.status) === column).length;
  const [todo, doing, done] = ['todo', 'doing', 'done'].map(count);
  return todo + doing + done ? `Board: ${todo} to do, ${doing} in progress, ${done} done` : null;
}
