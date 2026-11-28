// ADR 0048: where everything stands in the factory hall, in metres. One workshop
// per lane in a row along x at the front; Karajan's pieces wait at their posts
// at the back, the Sentinel on a raised post over the whole hall. No conveyor.
// KJC-TSK-1609 (the maintainer, 2026-11-13): wider, so its seats stand further apart (workers.js);
// KJC-TSK-1612: wider still, for the room each agent's backpack takes.
// KJC-TSK-1826, room for the belt beside the desks.
import { LINE, lineGroups } from './line-layout.js';
import { STATIONS, WORKSHOP } from './hall-sizes.js';

// WORKSHOP and STATIONS live in hall-sizes.js so line-layout.js can use them without an import cycle.
export { STATIONS, WORKSHOP } from './hall-sizes.js';
/** The pieces that wait in the row of posts: the Sentinel has its raised post. */
export const POSTS = STATIONS.filter((id) => id !== 'sentinel');
// KJC-TSK-1827: the posts stand on the line, left of the lanes, the Sentinel's too.
export const POST = { z: LINE.z, spacing: 1.6 };
/** A piece's plinth is 1 m wide before scaling (cast/piece.js). */
export const PLINTH_WIDTH = 1;
/** Pieces and robots are drawn for different shots in the film: these bring them to one smaller height. */
export const SCALE = { piece: 1, crew: 0.5, stand: 0.8 };
/** KJC-TSK-1459 (ADR 0050): the task board wall, behind the posts, right of the Sentinel's tower. */
// KJC-TSK-1703: straight behind the passage in the row of pieces (PASSAGE.x), so the way in is clear.
export const WALL = { x: 3.2, y: 0.3, z: -6.4, width: 3.4, height: 2.1 };
/** KJC-TSK-1526: the "Ready to release" table, right of the wall, past kaWATCHan. */
export const RELEASE_TABLE = { x: 7.4, z: -5.4, yaw: -0.5 };
/** KJC-TSK-1545: the version counter, on its post beside the table, turned as it is. */
export const VERSION_BOARD = { x: 8.9, z: -6.3, yaw: -0.5 };
/** Where kj sends its agents in from: the back of the hall, behind the posts. */
export const DOOR = { x: 0, z: -7.5 };

/** The x of the centre of workshop `i` of `n`, the row centred on the hall. */
export const workshopX = (i, n) => (i - (n - 1) / 2) * (WORKSHOP.width + WORKSHOP.gap);

// KJC-TSK-1828 (ADR "kj stage en una línea", accepted 2026-11-27): the workshops go in one row, left to
// right in the lanes' stretch of the line. KJC-TSK-1702 (the maintainer, 2026-11-19, "no quiero baile
// de bloques de trabajo"): a slot keeps its place whatever the number of workshops.
const PITCH = WORKSHOP.width + WORKSHOP.gap;
const lanesGroup = (n) => lineGroups(n).find((g) => g.id === 'lanes');

/** The centre `{x, z}` of slot `i` (of `_n`, which does not move it), in the lanes' stretch of the line. */
export const workshopAt = (i, _n) => ({ x: lanesGroup(1).from + WORKSHOP.gap / 2 + WORKSHOP.width / 2 + i * PITCH, z: WORKSHOP.z });

/**
 * KJC-TSK-1628 (the maintainer, 2026-11-14): the aisle in front of a row of workshops, past their
 * name plates and before the next row, where a host walks between the side door and its desk.
 */
export const AISLE_DZ = WORKSHOP.depth / 2 + 1.9;

/** How much deeper than a one-row hall `n` workshops make it: none, there is one row. */
export const hallDepth = (_n) => 0;
const lineGroup = (id) => lineGroups(1).find((g) => g.id === id);
const pieces = lineGroup('pieces');
const team = lineGroup('team');
const booth = lineGroup('booth');
/** The x of each piece's post, in the film's order, centred in the pieces' stretch of the line. */
export const postX = (id) => (pieces.from + pieces.to) / 2 + (STATIONS.indexOf(id) - (STATIONS.length - 1) / 2) * POST.spacing;
export const SENTINEL_POST = { x: postX('sentinel'), z: LINE.z, height: 1.8 };
/** The way to the wall no longer crosses the posts, which stand left of the lanes. */
export const PASSAGE = { x: WALL.x, front: { x: WALL.x, z: LINE.z } };
// The camera's fit stays as it was (the maintainer, 2026-11-28: fit about 45 m at most, drag for the rest).
const MIN_FIT_WIDTH = 26.2;
const MAX_FIT_WIDTH = 45;
/** How wide the hall is with `n` workshops, so the camera can fit it: four slots' worth, then the lanes up to 45 m. */
export const hallWidth = (n) => (n <= 2 ? MIN_FIT_WIDTH : Math.max(4 * PITCH, Math.min(n * PITCH, MAX_FIT_WIDTH)));

/** The x the camera looks at: the middle of the lanes' workshops; the drag's reach is measured from it. */
export const viewCentre = (n) => (workshopAt(0, n).x + workshopAt(n - 1, n).x) / 2;

/**
 * KJC-TSK-1592: how far a drag may walk the view over a hall of `n` workshops: its width, and its
 * depth from the door to the front of the last row, with room for that row's nameplates.
 */
// KJC-TSK-1827: the drag reaches the booth, at the left end of the line.
export const hallSpan = (n) => {
  const centre = viewCentre(n);
  const half = Math.max(centre - booth.from, workshopAt(n - 1, n).x + WORKSHOP.width / 2 - centre);
  // Still wide enough for the reach measured from x 0 (the drag clamps around the view centre).
  const fromZero = Math.max(2 * Math.abs(booth.from), 2 * Math.abs(lanesGroup(n).to));
  return { width: Math.max(hallWidth(n), 2 * half + 0.01, fromZero), depth: WORKSHOP.z + hallDepth(n) + WORKSHOP.depth / 2 + 1.5 - DOOR.z };
};

/**
 * KJC-BUG-0578: where a factory opened alone stands its mailbox (KJC-TSK-1473): just right of its
 * rightmost workshop, level with its last row; and how small, since here it is seen up close.
 */
export function mailboxSpot(n) {
  const right = workshopAt(n - 1, n).x + WORKSHOP.width / 2;
  return { x: right + 1.2, z: workshopAt(n - 1, n).z, scale: 0.55 };
}

/** KJC-TSK-1827: kaRAGan, atril, Karajan and his console, left to right in the team's stretch of the line. */
const teamX = (offset) => team.from + offset;
export const CREW = {
  conductor: { x: teamX(3.8), z: LINE.z, yaw: 0.6 },
  rag: { x: teamX(1), z: LINE.z, yaw: 0.5 },
  // KJC-TSK-1829 moves kaWATCHan with the release table; until then it keeps its present place.
  watch: { x: 6.2, z: -3, yaw: -0.6 },
};
export const STAND = { x: teamX(2.4), z: LINE.z, yaw: 0.7 };

/**
 * KJC-TSK-1632 (the maintainer, 2026-11-15): the teleport booth the hosts come and go by, beside
 * Karajan; on its left it hid atril (KJC-TSK-1636). KJC-BUG-0603: in Karajan's own row, on its right,
 * halfway to the first post, as tall as a robot and more; `exitZ` is where its way leaves the row,
 * in front of it, so it walks through none of the crew.
 */
export const BOOTH = { x: (booth.from + booth.to) / 2, z: LINE.z, height: 2.2, exitZ: LINE.z + 1.8 };
/** KJC-TSK-1659: Karajan's console, on his right, a little ahead, within his reach. */
export const CONSOLE = { x: CREW.conductor.x + 0.9, z: LINE.z + 0.5 };
/**
 * KJC-TSK-1632: the booth, and `edgeX`, where a host's way turns down past the left edge of the
 * first column of `n` workshops (KJC-TSK-1628), so it crosses none.
 */
export const boothAt = (n) => ({ ...BOOTH, edgeX: Math.min(BOOTH.x, workshopAt(0, n).x - WORKSHOP.width / 2 - 0.8) });
