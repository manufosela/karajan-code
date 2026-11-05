// KJC-TSK-1436 (ADR 0048): the Sentinel as it works. It watches from its raised
// post and turns to the lane whose host it is checking (the host's beat comes
// from the very hook the Sentinel runs on every tool call); on a denial it goes
// down to that lane's bench, stays by the agent it stopped, and climbs back.
// Pure: live.js moves the piece with what this says.
import { SENTINEL_POST, WORKSHOP } from './layout.js';

/** How long the Sentinel takes to go down (and back up), and how long it stays. */
export const DESCENT_MS = 1500;
export const STAY_MS = 1800;
// Beside the host at the bench of the lane, facing it.
const BY_THE_AGENT = { dx: -2.1, z: WORKSHOP.z - 0.4 };

const lane = (event) => event.lane ?? 'main';

/** The watch after an event: the lane it last looked at, and the denial it answers. */
export function withWatch(watch, event, now) {
  if (event?.type === 'sentinel-deny') return { ...watch, lane: lane(event), stop: { lane: lane(event), at: now } };
  if (event?.type === 'agent-activity' && event.role === 'host' && event.phase === 'start') return { ...watch, lane: lane(event) };
  return watch;
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

/** Where the Sentinel is at `now`, where it looks (yaw) and whether it is down; `xOf` gives a lane's x. */
export function sentinelAt(watch, now, xOf) {
  const post = { x: SENTINEL_POST.x, y: SENTINEL_POST.height, z: SENTINEL_POST.z };
  const k = watch.stop ? descent(now - watch.stop.at) : null;
  if (k !== null) {
    const agent = { x: xOf(watch.stop.lane) + BY_THE_AGENT.dx, y: 0, z: BY_THE_AGENT.z };
    const at = { x: post.x + (agent.x - post.x) * k, y: post.y * (1 - k), z: post.z + (agent.z - post.z) * k };
    return { ...at, yaw: facing(post, agent), down: true };
  }
  const yaw = watch.lane ? facing(post, { x: xOf(watch.lane), z: WORKSHOP.z }) : 0;
  return { ...post, yaw, down: false };
}
