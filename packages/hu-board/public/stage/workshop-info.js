// KJC-TSK-1620 (asked by the maintainer on 2026-11-14): a workshop's name is cut on its plate, so
// the pointer over it tells the whole of it and its HU. Pure: workshop-pointer.js shows it.
import { WORKSHOP } from './layout.js';
import { plateName } from './lane-status.js';

// How far in front of its pad a workshop's name plate reaches on the floor (hall.js).
const PLATE_REACH = 1.45;

/** The lane whose workshop (its pad or its name plate) holds the floor `point`; null when none. */
export function laneAtPoint(point, lanes, xOf, zOf) {
  if (!point) return null;
  return lanes.find((lane) => {
    const dz = point.z - zOf(lane);
    return Math.abs(point.x - xOf(lane)) <= WORKSHOP.width / 2 && dz >= -WORKSHOP.depth / 2 && dz <= WORKSHOP.depth / 2 + PLATE_REACH;
  }) ?? null;
}

/** The HU a lane is named after (`HU-4295-…`), as the stage's cards know it; null for a lane without one. */
export function huOfLane(lane, cards) {
  const id = /^HU-\d+/.exec(lane)?.[0];
  if (!id) return null;
  return cards.find((card) => card.id === id) ?? { id, title: null };
}

/**
 * The tooltip's lines: the lane's whole name; with an HU, its id and title (never the name again);
 * the lane's status `line`, which the plate cuts as well; and, when a click `opens` the HU, so.
 */
export function tipOf(lane, hu, line = '', opens = false) {
  const name = plateName(lane);
  const card = hu?.title ? `${hu.id} · ${hu.title}` : hu?.id;
  return [name, card === name ? null : card, line, hu && opens ? 'Click to open the HU' : null].filter(Boolean);
}

/** KJC-TSK-1621: the board's address of a project's HU. */
export const storyPath = (project, id) => `/api/stories/${encodeURIComponent([project, id].join('::'))}`;

const FACTS = [
  ['status', 'Status'], ['assignee', 'Assignee'], ['certified_as', 'As'], ['certified_want', 'I want'],
  ['certified_so_that', 'So that'], ['original_text', 'Story'], ['acceptance_criteria', 'Acceptance criteria'],
  ['outcome', 'Outcome'], ['updated_at', 'Updated'],
];

/** KJC-TSK-1621: what the board holds of an HU, as [label, text] in reading order; empty ones left out. */
export function storyFacts(story) {
  return FACTS.filter(([key]) => story[key] !== null && story[key] !== undefined && String(story[key]).trim() !== '')
    .map(([key, label]) => [label, key === 'updated_at' ? String(story[key]).slice(0, 16).replace('T', ' ') : String(story[key])]);
}
