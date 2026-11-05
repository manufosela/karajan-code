// ADR 0048: where everything stands in the factory hall, in metres. One workshop
// per lane in a row along x at the front; Karajan's pieces wait at their posts
// at the back, the Sentinel on a raised post over the whole hall. No conveyor.
export const WORKSHOP = { width: 4, depth: 3, gap: 0.8, z: 2.2 };
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
/** Where kj sends its agents in from: the back of the hall, behind the posts. */
export const DOOR = { x: 0, z: -7.5 };

/** The x of the centre of workshop `i` of `n`, the row centred on the hall. */
export const workshopX = (i, n) => (i - (n - 1) / 2) * (WORKSHOP.width + WORKSHOP.gap);
/** The x of each piece's post, the row centred behind the workshops. */
export const postX = (id) => (POSTS.indexOf(id) - (POSTS.length - 1) / 2) * POST.spacing;
/** How wide the hall is with `n` workshops, so the camera can fit it. */
export const hallWidth = (n) => Math.max(n * (WORKSHOP.width + WORKSHOP.gap), 2 * (END + 2));

/** Where kaRAGan, Karajan and kaWATCHan wait: at the ends of the row of posts. */
const END = ((POSTS.length + 1) / 2) * POST.spacing;
export const CREW = {
  conductor: { x: -END, z: POST.z, yaw: 0.6 },
  rag: { x: -END - 1.3, z: POST.z - 0.6, yaw: 0.5 },
  watch: { x: END, z: POST.z, yaw: -0.6 },
};
export const STAND = { x: -END - 1.4, z: POST.z - 1.8, yaw: 0.7 };
