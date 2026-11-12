// KJC-TSK-1565 (ADR 0056, decided by the maintainer on 2026-11-12): a person's avatar is a
// backpack with an emblem picked from this list, and each role of the scene may get its own
// colour. Pure, so the board (to keep it) and the scene (to draw and pick it) agree.
import { accentOf } from './workers.js';

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

/** The roles a robot of the scene can have (workers.js seats the first four). */
export const ROLES = ['host', 'coder', 'reviewer', 'solomon', 'subagent'];

const HEX = /^#[\da-f]{6}$/i;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** KJC-TSK-1570: the colour a role's picker shows before one is chosen (workers.js, an unknown agent's). */
const PLAIN = '#c0c8d0';

/** KJC-TSK-1570: what the panel's form saves: the emblem, and the colour of each role ticked as its own. */
export function avatarFromForm(entries) {
  const form = new Map(entries);
  const colors = Object.fromEntries(ROLES.filter((role) => form.has(`own-${role}`)).map((role) => [role, form.get(`color-${role}`)]));
  return cleanAvatar({ emblem: form.get('emblem') ?? null, colors });
}

/** KJC-TSK-1570: how the panel's form starts from a saved avatar (or none). */
export function formOf(avatar) {
  const { emblem, colors } = cleanAvatar(avatar);
  return { emblem, roles: ROLES.map((role) => ({ role, own: role in colors, color: colors[role] ?? PLAIN })) };
}

/** KJC-TSK-1569: what a known emblem draws; nothing for none. */
export const glyphOf = (emblem) => EMBLEMS.find((e) => e.id === emblem)?.glyph ?? null;

/** KJC-TSK-1569: a teammate's robot brings its owner's avatar (cleaned); an own one wears `own`. */
export const avatarFor = (worker, own) => (worker.avatar ? cleanAvatar(worker.avatar) : own);

/** KJC-TSK-1569: the colour the owner gave the robot's role, else its agent's (workers.js). */
export const accentFor = (worker, avatar) => {
  const color = avatar?.colors?.[worker.role];
  return color ? Number.parseInt(color.slice(1), 16) : accentOf(worker.agent);
};

/** Only a known emblem and a #rrggbb colour for a known role; anything else is dropped. */
export function cleanAvatar(value) {
  if (!isObject(value)) return { emblem: null, colors: {} };
  const emblem = EMBLEMS.some((e) => e.id === value.emblem) ? value.emblem : null;
  const given = isObject(value.colors) ? value.colors : {};
  const isColor = (role) => typeof given[role] === 'string' && HEX.test(given[role]);
  const colors = Object.fromEntries(ROLES.filter(isColor).map((role) => [role, given[role].toLowerCase()]));
  return { emblem, colors };
}
