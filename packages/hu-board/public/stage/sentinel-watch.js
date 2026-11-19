// KJC-TSK-1436 (ADR 0048): the Sentinel as it works. It watches from its raised
// post and turns to the lane whose host it is checking (the host's beat comes
// from the very hook the Sentinel runs on every tool call); on a denial its drone
// (KJC-TSK-1707) flies to the agent it stopped, hovers by it, and comes back.
// Pure: live.js moves the piece and its drone with what this says.
import { SENTINEL_POST, WORKSHOP } from './layout.js';
import { PIECE_WALK_MS } from './piece-visit.js';

/** How long the Sentinel takes to go down (and back up), and how long it stays. */
export const DESCENT_MS = 1500;
export const STAY_MS = 1800;
// Beside the host at the bench of the lane, facing it.
const BY_THE_AGENT = { dx: -3, dz: -0.6 }; // KJC-TSK-1612: beside the host's seat, further out

const lane = (event) => event.lane ?? 'main';

/**
 * KJC-BUG-0620 (the maintainer, 2026-11-16): "why does the Sentinel go to look at main if no one works
 * there?". A lane's session's denials are written in main's trace with no lane. A denial goes to the
 * lane where the robot of the session it stopped (`sid`) is seen; with none seen it is `unseen`.
 */
export function placeDenial(event, workers) {
  if (event?.type !== 'sentinel-deny') return event;
  const robot = event.sid ? workers.find((w) => w.id === event.sid) : null;
  return robot ? { ...event, lane: robot.lane } : { ...event, unseen: true };
}

/** The watch after an event: the lane it last looked at, and the denial it answers. */
export function withWatch(watch, event, now) {
  // KJC-BUG-0620: with no robot seen to answer it, the Sentinel stays at its post (it lights red there).
  if (event?.type === 'sentinel-deny' && event.unseen) return watch;
  if (event?.type === 'sentinel-deny') return { ...watch, lane: lane(event), stop: { lane: lane(event), at: now } };
  // KJC-TSK-1584: the beat is the Sentinel checking that call and letting it through.
  if (event?.type === 'agent-activity' && event.role === 'host' && event.phase === 'start') return { ...watch, lane: lane(event), checked: now };
  return watch;
}

/** KJC-TSK-1584: how long the Sentinel's light blinks when it lets a call through. */
export const BLINK_MS = 400;

/** How bright the Sentinel's own light blinks at `now` (0..1); 0 while it is down answering a denial. */
export function blinkAt(watch, now) {
  if (watch.checked === undefined) return 0;
  if (watch.stop && descent(now - watch.stop.at) !== null) return 0;
  const t = now - watch.checked;
  return t < 0 || t >= BLINK_MS ? 0 : Math.sin((Math.PI * t) / BLINK_MS);
}

const smooth = (k) => k * k * (3 - 2 * k);
const facing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

/** How far down the Sentinel is (0 on its post, 1 by the agent) `t` ms into a stop, or null once it is back. */
function descent(t) {
  if (t < 0 || t >= 2 * DESCENT_MS + STAY_MS) return null;
  if (t < DESCENT_MS) return smooth(t / DESCENT_MS);
  if (t < DESCENT_MS + STAY_MS) return 1;
  return smooth(1 - (t - DESCENT_MS - STAY_MS) / DESCENT_MS);
}

/**
 * Where the Sentinel is at `now` and where it looks (yaw); `xOf`/`zOf` give a lane's workshop.
 * KJC-TSK-1707 (the maintainer, 2026-11-19): it no longer goes down: it sends its drone (sentinelVisit).
 */
export function sentinelAt(watch, now, xOf, zOf = () => WORKSHOP.z) {
  const post = { x: SENTINEL_POST.x, y: SENTINEL_POST.height, z: SENTINEL_POST.z };
  const stopping = watch.stop && descent(now - watch.stop.at) !== null;
  const lane = stopping ? watch.stop.lane : watch.lane;
  const yaw = lane ? facing(post, { x: xOf(lane), z: zOf(lane) }) : 0;
  return { ...post, yaw, down: false };
}

/** KJC-TSK-1707: a denial as the visit of the Sentinel's drone (piece-drone.js), by the agent it stopped; none without one. */
export function sentinelVisit(watch) {
  if (!watch.stop) return undefined;
  const { lane: stopped, at } = watch.stop;
  return { piece: 'sentinel', lane: stopped, at, until: at + PIECE_WALK_MS + STAY_MS, spot: BY_THE_AGENT, from: null };
}
