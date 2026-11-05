// KJC-TSK-1399 (ADR 0047): each real event is a box on the factory line. It
// enters at the start of the line, rides to the station of its piece and stops
// there while the station flashes. Pure: no three.js, the scene reads the box.
import { CUE_MS } from './director.js';
import { LINE, STATION_X, STATIONS } from './layout.js';

/** How long a box takes to ride from the start of the line to its station, in ms. */
export const TRAVEL_MS = 1600;
/** How long a cue lives: its ride plus its flash at the station. */
export const LIFETIME_MS = TRAVEL_MS + CUE_MS;

const easeInOut = (k) => k * k * (3 - 2 * k);

/** Where a cue's box is at `now` and how much its station flashes (0..1), or null when it is not on the line. */
export function boxAt(cue, now) {
  const t = now - cue.at;
  if (t < 0 || t >= LIFETIME_MS) return null;
  const target = STATION_X[STATIONS.indexOf(cue.piece)];
  if (t < TRAVEL_MS) return { x: LINE.from + (target - LINE.from) * easeInOut(t / TRAVEL_MS), arrived: false, flash: 0 };
  return { x: target, arrived: true, flash: Math.sin((Math.PI * (t - TRAVEL_MS)) / CUE_MS) };
}
