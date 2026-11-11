// KJC-TSK-1438 (ADR 0048): kaRAGan as it works. When the RAG answers a lane's
// question it walks from its post to that lane's bench, behind the host that
// asked, hands the answer over and walks back. Pure: live.js moves its robot.
import { CREW, WORKSHOP } from './layout.js';

/** How long kaRAGan walks each way, and how long it stays handing the answer over. */
export const RAGAN_WALK_MS = 2200;
export const HAND_MS = 1500;
// Behind the host's spot at the bench (workers.js puts the host 1.3 m to the left).
const BEHIND_HOST = { dx: -1.3, dz: -1.2 };

/** The answer kaRAGan is taking after an event at `now`, or the one it had. */
export const withRag = (rag, event, now) =>
  (event?.type === 'rag-answer' ? { lane: event.lane ?? 'main', at: now } : rag);

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
const facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);

/** KJC-TSK-1522: a reindex that never says it ended sends kaRAGan back after this long. */
export const INDEX_MAX_MS = 15 * 60 * 1000;

/** The reindex kaRAGan works on after an event at `now`: a start opens one, the end of its lane closes it. */
export function withIndex(index, event, now) {
  if (event?.type !== 'rag-index') return index;
  const lane = event.lane ?? 'main';
  if (event.phase === 'start') return { lane, at: now, end: null };
  return index?.lane === lane && index.end === null ? { ...index, end: now } : index;
}

const benchOf = (lane, xOf, zOf) => ({ x: xOf(lane) + BEHIND_HOST.dx, z: zOf(lane) + BEHIND_HOST.dz });

/** KJC-TSK-1522: kaRAGan going to type at a reindexing lane, typing there, or coming back; null when not. */
function indexingAt(index, now, home, xOf, zOf) {
  if (!index) return null;
  const bench = benchOf(index.lane, xOf, zOf);
  const leave = Math.max(Math.min(index.end ?? Infinity, index.at + INDEX_MAX_MS), index.at + RAGAN_WALK_MS);
  const t = now - index.at;
  if (t < 0 || now >= leave + RAGAN_WALK_MS) return null;
  if (t < RAGAN_WALK_MS) return { ...lerp(home, bench, t / RAGAN_WALK_MS), yaw: facing(home, bench), walking: true, typing: false };
  if (now < leave) return { ...bench, yaw: 0, walking: false, typing: true, since: index.at + RAGAN_WALK_MS };
  return { ...lerp(bench, home, (now - leave) / RAGAN_WALK_MS), yaw: facing(bench, home), walking: true, typing: false };
}

/**
 * Where kaRAGan is at `now`, where it faces, whether it walks and whether it types; `xOf`/`zOf`
 * give a lane's workshop. A reindex (KJC-TSK-1522) goes before an answer to take.
 */
export function raganAt(rag, now, xOf, zOf = () => WORKSHOP.z, index = null) {
  const home = { x: CREW.rag.x, z: CREW.rag.z };
  const rest = { ...home, yaw: CREW.rag.yaw, walking: false };
  const indexing = indexingAt(index, now, home, xOf, zOf);
  if (indexing) return indexing;
  if (!rag) return rest;
  const bench = benchOf(rag.lane, xOf, zOf);
  const t = now - rag.at;
  if (t < 0 || t >= 2 * RAGAN_WALK_MS + HAND_MS) return rest;
  if (t < RAGAN_WALK_MS) return { ...lerp(home, bench, t / RAGAN_WALK_MS), yaw: facing(home, bench), walking: true };
  if (t < RAGAN_WALK_MS + HAND_MS) return { ...bench, yaw: 0, walking: false };
  const k = (t - RAGAN_WALK_MS - HAND_MS) / RAGAN_WALK_MS;
  return { ...lerp(bench, home, k), yaw: facing(bench, home), walking: true };
}
