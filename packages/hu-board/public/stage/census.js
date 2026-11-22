// KJC-TSK-1718 (the maintainer, 2026-11-22): a strip over the projects panel counts, across every
// factory of the board's summary, the kaRAGans indexing or answering and the Karajans at work,
// coding, reviewing or waiting for the person. Pure: main.js draws it.

/** What one agent of a lane's `working` counts as. A host waiting for a process is still at work. */
function kindOf({ role, waiting }) {
  if (waiting === 'person') return 'waiting';
  if (role === 'coder') return 'coding';
  if (role === 'reviewer') return 'reviewing';
  return 'working';
}

/** The totals of `factories` (`/api/stage/summary`). */
export function censusOf(factories) {
  const census = { indexing: 0, answering: 0, working: 0, coding: 0, reviewing: 0, waiting: 0 };
  for (const lane of factories.flatMap((f) => f.lanes ?? [])) {
    if (lane.rag?.indexing) census.indexing += 1;
    if (lane.rag?.answering) census.answering += 1;
    for (const agent of lane.working ?? []) census[kindOf(agent)] += 1;
  }
  return census;
}

/** A no-break space keeps each count with its word when the strip wraps. */
export const NBSP = String.fromCodePoint(0xa0);
const said = (parts) => parts.filter(([n]) => n > 0).map(([n, what]) => [n, what].join(NBSP)).join(' · ') || 'quiet';

/** What the strip says of kaRAGan and of Karajan, the counts that are not zero; "quiet" when none. */
export const censusLines = ({ indexing, answering, working, coding, reviewing, waiting }) => ({
  rag: said([[indexing, 'indexing'], [answering, 'answering']]),
  karajan: said([[working, 'at work'], [coding, 'coding'], [reviewing, 'reviewing'], [waiting, 'waits for you']]),
});
