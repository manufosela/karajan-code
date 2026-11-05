// KJC-TSK-1438 (ADR 0048): kaRAGan as it works. When the RAG answers a lane's
// question it walks from its post to that lane's bench, behind the host that
// asked, hands the answer over and walks back. Pure: live.js moves its robot.
import { CREW, WORKSHOP } from './layout.js';

/** How long kaRAGan walks each way, and how long it stays handing the answer over. */
export const RAGAN_WALK_MS = 2200;
export const HAND_MS = 1500;
// Behind the host's spot at the bench (workers.js puts the host 1.3 m to the left).
const BEHIND_HOST = { dx: -1.3, z: WORKSHOP.z - 1.2 };

/** The answer kaRAGan is taking after an event at `now`, or the one it had. */
export const withRag = (rag, event, now) =>
  (event?.type === 'rag-answer' ? { lane: event.lane ?? 'main', at: now } : rag);

const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
const facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);

/** Where kaRAGan is at `now`, where it faces and whether it walks; `xOf` gives a lane's x. */
export function raganAt(rag, now, xOf) {
  const home = { x: CREW.rag.x, z: CREW.rag.z };
  const rest = { ...home, yaw: CREW.rag.yaw, walking: false };
  if (!rag) return rest;
  const bench = { x: xOf(rag.lane) + BEHIND_HOST.dx, z: BEHIND_HOST.z };
  const t = now - rag.at;
  if (t < 0 || t >= 2 * RAGAN_WALK_MS + HAND_MS) return rest;
  if (t < RAGAN_WALK_MS) return { ...lerp(home, bench, t / RAGAN_WALK_MS), yaw: facing(home, bench), walking: true };
  if (t < RAGAN_WALK_MS + HAND_MS) return { ...bench, yaw: 0, walking: false };
  const k = (t - RAGAN_WALK_MS - HAND_MS) / RAGAN_WALK_MS;
  return { ...lerp(bench, home, k), yaw: facing(bench, home), walking: true };
}
