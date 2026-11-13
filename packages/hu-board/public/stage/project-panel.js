// KJC-TSK-1590 (asked by the maintainer on 2026-11-13): a side panel lists the projects of the
// map, and one opens only its own factory, which zooms with the wheel or a pinch. Pure: main.js
// draws the panel.
import { columnOf, mergeCards } from './cards.js';

/** One entry per factory of the map (`/api/stage/map`), in its order; `current` is the open one. */
export function panelEntries(factories, current) {
  return factories.map(({ project, name, lanes = [] }) => ({
    project,
    name,
    working: lanes.reduce((n, l) => n + (l.working?.length ?? 0), 0),
    // A card that went through several lanes counts once, at its newest line.
    doing: mergeCards(lanes.map((l) => l.cards ?? [])).filter((c) => columnOf(c.status) === 'doing').length,
    // KJC-TSK-1605: the handoffs that wait for the human, in every lane.
    // KJC-TSK-1607: and every host that waits for the human.
    waiting: lanes.reduce((n, l) => n + (l.mail ?? 0) + (l.working ?? []).filter((w) => w.waiting === 'person').length, 0),
    current: project === current,
  }));
}

/** KJC-TSK-1605: the badge of a factory that needs the human: its count and what it says aloud; none otherwise. */
export const panelBadge = ({ waiting }) => (waiting ? { text: String(waiting), label: `${waiting} waiting for you` } : null);

/** What goes on in a project, under its name. */
export function panelLine({ working, doing }) {
  const parts = [working && `${working} at work`, doing && `${doing} in progress`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'quiet';
}

/** The stage of that project's factory alone. */
export const panelHref = (project) => `/stage.html?project=${encodeURIComponent(project)}`;
