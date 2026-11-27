// KJC-TSK-1590 (asked by the maintainer on 2026-11-13): a side panel lists the projects of the
// map, and one opens only its own factory, which zooms with the wheel or a pinch. Pure: main.js
// draws the panel.
import { columnOf, mergeCards } from './cards.js';
import { isIdle } from './idle-waits.js';

// KJC-TSK-1629 (the maintainer, 2026-11-14): alphabetically, case and accents aside, to find one.
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** How many of the lanes' `working` are `which`. */
const count = (lanes, which) => lanes.reduce((n, l) => n + (l.working ?? []).filter(which).length, 0);

/** One entry per factory of the map (`/api/stage/map`), by name; `current` is the open one. */
export function panelEntries(factories, current) {
  return factories.toSorted(byName).map(({ project, name, lanes = [] }) => ({
    project,
    name,
    working: count(lanes, (w) => !isIdle(w)),
    // KJC-TSK-1805: the sessions open with nothing to do, apart; KJC-TSK-1811: and those with no work left.
    resting: count(lanes, (w) => w.waiting === 'rest'),
    done: count(lanes, (w) => w.waiting === 'done'),
    // A card that went through several lanes counts once, at its newest line.
    doing: mergeCards(lanes.map((l) => l.cards ?? [])).filter((c) => columnOf(c.status) === 'doing').length,
    // KJC-TSK-1605: the handoffs that wait for the human, in every lane.
    // KJC-TSK-1607: and every host that waits for the human.
    waiting: lanes.reduce((n, l) => n + (l.mail ?? 0) + (l.working ?? []).filter((w) => w.waiting === 'person').length, 0),
    current: project === current,
  }));
}

/**
 * KJC-TSK-1690 (the maintainer, 2026-11-18): only the factories with a session on, an agent in them
 * working or waiting; and the one on screen, even stopped, so it is never lost from the list.
 */
// KJC-BUG-0645: on the map of every factory (`map`), all of them, as the map draws them.
export const liveEntries = (entries, { map = false } = {}) => (map ? entries : entries.filter((entry) => entry.working > 0 || entry.resting > 0 || entry.done > 0 || entry.current));

/** KJC-TSK-1605: the badge of a factory that needs the human: its count and what it says aloud; none otherwise. */
export const panelBadge = ({ waiting }) => (waiting ? { text: String(waiting), label: `${waiting} waiting for you` } : null);

/** What goes on in a project, under its name. */
export function panelLine({ working, resting, done, doing }) {
  const parts = [working && `${working} at work`, resting && `${resting} resting`, done && `${done} done`, doing && `${doing} in progress`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'quiet';
}

/** The stage of that project's factory alone. */
export const panelHref = (project) => `/stage.html?project=${encodeURIComponent(project)}`;

/** KJC-TSK-1613: the project a stage address (its `location.search`) opens; null when none. */
export const projectOf = (search) => new URLSearchParams(search).get('project');

/**
 * KJC-TSK-1613: whether a click on a panel entry switches the factory in the same page; one that
 * asks for another tab or window (a modifier key, the middle button) is left to the browser.
 */
export const opensInPlace = (event) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
