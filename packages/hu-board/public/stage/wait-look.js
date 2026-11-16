// KJC-TSK-1653 (asked by the maintainer on 2026-11-16): a waiting host shows what it waits for. Its
// session's last "Me paro por…" line says it (stop-reason.js): waiting for you, it turns to the camera,
// raises its hand and an amber "!" beats over it; waiting for a process, a blue hourglass turns over
// it. Pure: wait-mark.js draws the marks and agents-floor.js the pose.

/** How long one beat of the "!" lasts, and one turn of the hourglass. */
export const WAIT_BEAT_MS = 1200;
const TURN_MS = 3000;

/** How a host waiting for `waiting` ('person' | 'process') looks at `t` (ms); null when it does not wait. */
export function waitLook(waiting, t) {
  if (waiting === 'person') {
    const beat = Math.abs(Math.sin((Math.PI * t) / WAIT_BEAT_MS));
    // The hand up, waving a little; the "!" beating between half and full.
    return { mark: 'alert', facesCamera: true, hand: 2.5 + 0.2 * Math.sin((2 * Math.PI * t) / WAIT_BEAT_MS), pulse: 0.5 + 0.5 * beat, spin: 0 };
  }
  if (waiting === 'process') return { mark: 'hourglass', facesCamera: false, hand: 0, pulse: 1, spin: ((2 * Math.PI * t) / TURN_MS) % (2 * Math.PI) };
  return null;
}
