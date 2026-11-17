// KJC-TSK-1490 (decided by the maintainer on 2026-11-09): Karajan conducts when the
// method acts. A review verdict, a commit at the gates or a Ledger seal turn it to that
// lane's workshop: it waves its baton when the work passes and raises its free hand to
// stop it when it does not. Pure: live.js poses its robot.
import { CONSOLE, CREW, WORKSHOP } from './layout.js';

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
 * KJC-TSK-1659 (the maintainer, 2026-11-17): "when an agent appears in the capsule, could Karajan,
 * who is beside it, press a button?" How long Karajan takes to press the booth's console button.
 */
export const PRESS_MS = 1100;

/** How lit the console's button is at `now` after a press at `pressed` (0 dark, 1 full). */
export function buttonAt(pressed, now) {
  const t = pressed === null || pressed === undefined ? -1 : now - pressed;
  return t < 0 || t >= PRESS_MS ? 0 : Math.sin((Math.PI * t) / PRESS_MS);
}

/**
 * Where Karajan faces and how it holds each arm, `[spread, forward]` as robot.pose takes
 * them, at `now`; `xOf`/`zOf` give a lane's workshop. KJC-TSK-1659: a press at `pressed`
 * (someone teleporting in) goes first: it turns to the console and pushes the button.
 */
export function conductorAt(beat, now, xOf, zOf = () => WORKSHOP.z, pressed = null) {
  const k = buttonAt(pressed, now);
  if (k > 0) {
    const yaw = Math.atan2(CONSOLE.x - CREW.conductor.x, CONSOLE.z - CREW.conductor.z);
    return { yaw, L: [0, 0], R: [0.2, 0.6 + 0.8 * k] };
  }
  const t = beat ? now - beat.at : -1;
  if (t < 0 || t >= BEAT_MS) return { yaw: CREW.conductor.yaw, ...REST };
  const yaw = Math.atan2(xOf(beat.lane) - CREW.conductor.x, zOf(beat.lane) - CREW.conductor.z);
  if (!beat.passed) return { yaw, L: [0.3, 1.6], R: [0, 0] };
  const stroke = Math.sin((2 * Math.PI * t) / WAVE_MS);
  return { yaw, L: [0.5, 0.3], R: [1.5, 0.6 + 0.5 * stroke] };
}
