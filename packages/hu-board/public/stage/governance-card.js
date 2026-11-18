// KJC-TSK-1685 (decided by the maintainer on 2026-11-18): the governance panel kj resolves for the
// project, as a card on top of the stage: each role with its agent in the colour its robots wear,
// and the agent standing in for another, for whom and why. Pure: main.js draws it.
import { accentOf } from './workers.js';

const ROLES = [['coder', 'Coder'], ['reviewer', 'Reviewer'], ['solomon', 'Solomon']];
const REASONS = { quota: 'no quota' };
const hex = (colour) => `#${colour.toString(16).padStart(6, '0')}`;

/** The card's cells, one per role the panel names: { role, agent, colour, standIn }. */
export function panelCells(panel) {
  if (!panel) return [];
  const subs = panel.substitutions ?? {};
  return ROLES.filter(([key]) => panel[key] || subs[key]).map(([key, role]) => {
    const sub = subs[key];
    const agent = sub ? sub.acting : panel[key];
    const standIn = sub ? `for ${sub.declared}: ${REASONS[sub.reason] ?? sub.reason}` : null;
    return { role, agent, colour: hex(accentOf(agent)), standIn };
  });
}
