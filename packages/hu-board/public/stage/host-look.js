// KJC-TSK-1598 (decided by the maintainer on 2026-11-13): each host stands out from every other robot,
// and one person's host from another's. A little bigger, with a halo of light over its head in the
// colour its owner gave the host role, its owner's emblem on its chest and its owner's login first on
// its label. Pure: agents-floor.js dresses the robot with what this says.
import { accentFor, glyphOf } from './avatars.js';
import { labelOf } from './workers.js';

export const HOST_SCALE = 1.2;
// Where the laptop opens on a robot of plain size, over its hover (laptop.js, agents-floor.js).
const LAPTOP = { hover: 0.1, up: 0.62, ahead: 1.05 };

/** Whose host it is: a teammate's by its owner, the own one by `own.login`; null when unknown. */
export const ownerOf = (worker, own) => worker.owner ?? own?.login ?? null;

/** Its label: its owner first, then what it said before (its session or agent, and its tool). */
export function hostLabel(worker, own) {
  const owner = ownerOf(worker, own);
  return owner ? `${owner} · ${labelOf(worker)}` : labelOf(worker);
}

/** Its halo's colour: the one its owner gave the host role (`avatar` is the one it wears), else its agent's. */
export const haloColor = (worker, avatar) => accentFor(worker, avatar);

/**
 * KJC-TSK-1601 (the maintainer, 2026-11-13): what the hologram over its head shows, instead of a
 * halo: its owner's emblem (`avatar` is the one it wears), else its owner's initial, else its agent's.
 */
export function hologramOf(worker, avatar, own) {
  return glyphOf(avatar?.emblem) ?? (ownerOf(worker, own) ?? worker.agent).charAt(0).toUpperCase();
}

/** What its chest plate shows: its owner's emblem, else its agent's name as before. */
export const chestOf = (worker, avatar) => glyphOf(avatar?.emblem) ?? worker.agent;

/**
 * Where the laptop of a robot `k` times the plain size opens, in its own frame, so that it stays at
 * the height and reach of every other robot's, over its desk; and how much smaller it is drawn.
 */
export function laptopLift(k) {
  if (k === 1) return { up: LAPTOP.up, ahead: LAPTOP.ahead, scale: 1 };
  return { up: (LAPTOP.hover + LAPTOP.up) / k - LAPTOP.hover, ahead: LAPTOP.ahead / k, scale: 1 / k };
}
