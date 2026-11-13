// KJC-TSK-1565 (ADR 0056, decided by the maintainer on 2026-11-12): a person's avatar is a
// backpack with an emblem picked from this list. KJC-TSK-1603 (the maintainer, 2026-11-13): and one
// colour of their own, which marks all their robots; no colour per role. Pure, so the board (to
// keep it) and the scene (to draw and pick it) agree.

export const EMBLEMS = [
  { id: 'fox', glyph: '🦊', label: 'Fox' },
  { id: 'owl', glyph: '🦉', label: 'Owl' },
  { id: 'bear', glyph: '🐻', label: 'Bear' },
  { id: 'cat', glyph: '🐱', label: 'Cat' },
  { id: 'panda', glyph: '🐼', label: 'Panda' },
  { id: 'penguin', glyph: '🐧', label: 'Penguin' },
  { id: 'turtle', glyph: '🐢', label: 'Turtle' },
  { id: 'octopus', glyph: '🐙', label: 'Octopus' },
  { id: 'rocket', glyph: '🚀', label: 'Rocket' },
  { id: 'bolt', glyph: '⚡', label: 'Bolt' },
];

/** The roles a robot of the scene can have (workers.js seats the first four); an older avatar's colours were by role. */
export const ROLES = ['host', 'coder', 'reviewer', 'solomon', 'subagent'];

const HEX = /^#[\da-f]{6}$/i;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** KJC-TSK-1570: the colour the picker shows before one is chosen (workers.js, an unknown agent's). */
const PLAIN = '#c0c8d0';

/**
 * KJC-TSK-1570: what the panel's form saves: the emblem and, KJC-TSK-1603, the person's colour when
 * ticked as their own.
 */
export function avatarFromForm(entries) {
  const form = new Map(entries);
  return cleanAvatar({ emblem: form.get('emblem') ?? null, color: form.has('own-color') ? form.get('color') : null });
}

/** KJC-TSK-1570: how the panel's form starts from a saved avatar (or none). */
export function formOf(avatar) {
  const { emblem, color } = cleanAvatar(avatar);
  return { emblem, own: color !== null, color: color ?? PLAIN };
}

/** KJC-TSK-1569: what a known emblem draws; nothing for none. */
export const glyphOf = (emblem) => EMBLEMS.find((e) => e.id === emblem)?.glyph ?? null;

/** KJC-TSK-1569: a teammate's robot brings its owner's avatar (cleaned); an own one wears `own`. */
export const avatarFor = (worker, own) => (worker.avatar ? cleanAvatar(worker.avatar) : own);

/** KJC-TSK-1603: the person's colour as a number, which marks all their robots; null without one. */
export const ownerColor = (avatar) => (avatar?.color ? Number.parseInt(avatar.color.slice(1), 16) : null);

const isHex = (value) => typeof value === 'string' && HEX.test(value);

/**
 * Only a known emblem and a #rrggbb colour; anything else is dropped. KJC-TSK-1603: one colour per
 * person; a colour per role, saved before or sent by an older kj, becomes the host's, else the first.
 */
export function cleanAvatar(value) {
  if (!isObject(value)) return { emblem: null, color: null };
  const emblem = EMBLEMS.some((e) => e.id === value.emblem) ? value.emblem : null;
  const legacy = isObject(value.colors) ? value.colors : {};
  const given = isHex(value.color) ? value.color : ROLES.map((role) => legacy[role]).find(isHex);
  return { emblem, color: given ? given.toLowerCase() : null };
}
