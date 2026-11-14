// KJC-TSK-1618: how each card of the cast legend (legend.js) draws its character, with the scene's
// own builders: an agent as a worker with the own avatar or a teammate's, a row of robots in each
// model's wardrobe, a crew robot, a method piece, atril, or a thing of the hall. Pure:
// legend-portraits.js draws them.
import { STATIONS } from './layout.js';

/** A teammate's avatar for their host's portrait: another person, another colour and emblem. */
export const TEAMMATE = { emblem: 'owl', color: '#4fb3e8' };

const AGENTS = {
  host: { worker: { role: 'host', agent: 'claude', model: 'opus', effort: 'high' }, avatar: 'own' },
  teammate: { worker: { role: 'host', agent: 'codex', owner: 'teammate' }, avatar: 'teammate' },
  coder: { worker: { role: 'coder', agent: 'claude', model: 'sonnet', effort: 'medium' }, avatar: 'own' },
  solomon: { worker: { role: 'solomon', agent: 'agy' }, avatar: 'own' },
  subagent: { worker: { role: 'subagent', agent: 'claude' }, avatar: 'own' },
};
const RECIPES = {
  ...AGENTS,
  wardrobe: { wardrobe: ['fable', 'opus', 'sonnet', 'haiku'] },
  ...Object.fromEntries(['conductor', 'rag', 'watch', 'courier'].map((id) => [id, { crew: id }])),
  ...Object.fromEntries(STATIONS.map((id) => [id, { piece: id }])),
  atril: { stand: true },
  ...Object.fromEntries(['wall', 'release', 'drone', 'mailbox'].map((id) => [id, { thing: id }])),
};

/** The recipe of the card `id`'s portrait; null for a card without one. */
export const recipeOf = (id) => RECIPES[id] ?? null;
