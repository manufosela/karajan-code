// ADR 0048: where everything stands in the factory hall, in metres. One workshop
// per lane in a row along x at the front; Karajan's pieces wait at their posts
// at the back, the Sentinel on a raised post over the whole hall. No conveyor.
// KJC-TSK-1609 (the maintainer, 2026-11-13): wider, so its seats stand further apart (workers.js).
export const WORKSHOP = { width: 5, depth: 3, gap: 0.8, z: 2.2 };
/** Karajan's pieces, in the film's order (crew.js builds them in it). */
export const STATIONS = ['tdd', 'sentinel', 'review', 'gates', 'sonar', 'ledger', 'steward'];
/** The pieces that wait in the row of posts: the Sentinel has its raised post. */
export const POSTS = STATIONS.filter((id) => id !== 'sentinel');
export const POST = { z: -3, spacing: 1.6 };
export const SENTINEL_POST = { x: 0, z: -5.4, height: 1.8 };
/** A piece's plinth is 1 m wide before scaling (cast/piece.js). */
export const PLINTH_WIDTH = 1;
/** Pieces and robots are drawn for different shots in the film: these bring them to one smaller height. */
export const SCALE = { piece: 1, crew: 0.5, stand: 0.8 };
/** KJC-TSK-1459 (ADR 0050): the task board wall, behind the posts, right of the Sentinel's tower. */
export const WALL = { x: 3.6, y: 0.3, z: -6.4, width: 3.4, height: 2.1 };
/** KJC-TSK-1526: the "Ready to release" table, right of the wall, past kaWATCHan. */
export const RELEASE_TABLE = { x: 7.4, z: -5.4, yaw: -0.5 };
/** KJC-TSK-1545: the version counter, on its post beside the table, turned as it is. */
export const VERSION_BOARD = { x: 8.9, z: -6.3, yaw: -0.5 };
/** Where kj sends its agents in from: the back of the hall, behind the posts. */
export const DOOR = { x: 0, z: -7.5 };

/** The x of the centre of workshop `i` of `n`, the row centred on the hall. */
export const workshopX = (i, n) => (i - (n - 1) / 2) * (WORKSHOP.width + WORKSHOP.gap);

// KJC-TSK-1488 (decided by the maintainer on 2026-11-09): a factory of many lanes lays
// its workshops in rows and columns, wider than deep as the screen is, the first row in
// front of the posts and the next ones towards the camera; up to four stay in one row.
const ONE_ROW = 4;
/** From one row of workshops to the next: a workshop and room for its nameplate. */
const ROW_STEP = WORKSHOP.depth + 2.4;
const columnsOf = (n) => (n <= ONE_ROW ? n : Math.max(ONE_ROW, Math.ceil(Math.sqrt(2 * n))));
const rowsOf = (n) => Math.ceil(n / Math.max(1, columnsOf(n)));

/** The centre `{x, z}` of workshop `i` of `n`, row by row, each row centred on the hall. */
export function workshopAt(i, n) {
  const columns = columnsOf(n);
  return { x: workshopX(i % columns, columns), z: WORKSHOP.z + Math.floor(i / columns) * ROW_STEP };
}

/** How much deeper than a one-row hall the rows of `n` workshops make it. */
export const hallDepth = (n) => (rowsOf(n) - 1) * ROW_STEP;
/** The x of each piece's post, the row centred behind the workshops. */
export const postX = (id) => (POSTS.indexOf(id) - (POSTS.length - 1) / 2) * POST.spacing;
/** How wide the hall is with `n` workshops, so the camera can fit it. */
export const hallWidth = (n) => Math.max(columnsOf(n) * (WORKSHOP.width + WORKSHOP.gap), 2 * (END + 3.5));

/**
 * KJC-TSK-1592: how far a drag may walk the view over a hall of `n` workshops: its width, and its
 * depth from the door to the front of the last row, with room for that row's nameplates.
 */
export const hallSpan = (n) => ({ width: hallWidth(n), depth: WORKSHOP.z + hallDepth(n) + WORKSHOP.depth / 2 + 1.5 - DOOR.z });

/**
 * KJC-BUG-0578: where a factory opened alone stands its mailbox (KJC-TSK-1473): just right of its
 * rightmost workshop, level with its last row; and how small, since here it is seen up close.
 */
export function mailboxSpot(n) {
  const right = Math.max(...Array.from({ length: n }, (_, i) => workshopAt(i, n).x)) + WORKSHOP.width / 2;
  return { x: right + 1.2, z: workshopAt(n - 1, n).z, scale: 0.55 };
}

/** Where kaRAGan, Karajan and kaWATCHan wait: at the ends of the row of posts. */
const END = ((POSTS.length + 1) / 2) * POST.spacing;
export const CREW = {
  conductor: { x: -END, z: POST.z, yaw: 0.6 },
  // KJC-TSK-1487: beside atril, on its outer side; in front of it, it hid it from the camera.
  rag: { x: -END - 2.8, z: POST.z - 1.5, yaw: 0.5 },
  watch: { x: END, z: POST.z, yaw: -0.6 },
};
export const STAND = { x: -END - 1.4, z: POST.z - 1.8, yaw: 0.7 };
