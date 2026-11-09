// KJC-TSK-1490 (decided by the maintainer on 2026-11-09): Karajan conducts when the
// method acts. A review verdict, a commit at the gates or a Ledger seal turn it to that
// lane's workshop: it waves its baton when the work passes and raises its free hand to
// stop it when it does not. Pure: live.js poses its robot.
import { CREW, WORKSHOP } from './layout.js';

/** How long Karajan answers one act of the method, in ms. */
export const BEAT_MS = 2400;
const WAVE_MS = 600; // one stroke of the baton

/** Whether an act of the method passed, or null for any other event. */
function passedOf(event) {
  switch (event?.type) {
    case 'review-verdict': return event.verdict === 'approved';
    case 'commit-gate': return event.outcome === 'pass';
    case 'ledger-seal': return event.decision !== 'deny';
    default: return null;
  }
}

/** The beat Karajan answers after an event at `now`, or the one it had. */
export function withBeat(beat, event, now) {
  const passed = passedOf(event);
  return passed === null ? beat : { lane: event.lane ?? 'main', at: now, passed };
}

const REST = { L: [0, 0], R: [0, 0] };

/**
 * Where Karajan faces and how it holds each arm, `[spread, forward]` as robot.pose takes
 * them, at `now`; `xOf`/`zOf` give a lane's workshop.
 */
export function conductorAt(beat, now, xOf, zOf = () => WORKSHOP.z) {
  const t = beat ? now - beat.at : -1;
  if (t < 0 || t >= BEAT_MS) return { yaw: CREW.conductor.yaw, ...REST };
  const yaw = Math.atan2(xOf(beat.lane) - CREW.conductor.x, zOf(beat.lane) - CREW.conductor.z);
  if (!beat.passed) return { yaw, L: [0.3, 1.6], R: [0, 0] };
  const stroke = Math.sin((2 * Math.PI * t) / WAVE_MS);
  return { yaw, L: [0.5, 0.3], R: [1.5, 0.6 + 0.5 * stroke] };
}
