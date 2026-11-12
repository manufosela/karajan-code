// KJC-TSK-1549 (ADR 0054, slice 2): the lots of the map, own and the teammates'. Each teammate of
// a factory with cards in progress gets a lot of its own right after it: a workshop per card,
// drawn as the last known state, nothing live. The board sends them as `team` (stage-team.js).
// Pure: map.js packs and draws these.

/**
 * KJC-TSK-1550 (ADR 0054, slice 3): how old a teammate's news may be before its factory goes dim.
 * The ADR leaves it open; 30 min to start with.
 */
export const DIM_AFTER_MS = 30 * 60 * 1000;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** How long ago (`now`, ms) the board saw a teammate's news written at `at`. */
export function ageLabel(at, now) {
  const age = now - Date.parse(at);
  if (Number.isNaN(age)) return 'age unknown';
  if (age < MIN) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MIN)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  return `${Math.floor(age / DAY)} d ago`;
}

/** Whether a teammate's news is too old to stand lit: past the limit, or of an unknown age. */
export function isStale(at, now) {
  const age = now - Date.parse(at);
  return Number.isNaN(age) || age >= DIM_AFTER_MS;
}

/**
 * @returns {Array<{key: string, project: string, own: boolean, name: string, laneNames: string[], person?: string, cards?: object[], at?: string}>}
 */
export function mapLots(factories) {
  return factories.flatMap((f) => [
    { key: f.project, project: f.project, own: true, name: f.name ?? f.project, laneNames: f.lanes.map((l) => l.lane) },
    ...(f.team ?? []).filter((t) => t.cards.length).map((t) => ({
      key: `${f.project}@${t.person}`,
      project: f.project,
      own: false,
      name: `${t.person} · ${f.name ?? f.project}`,
      laneNames: t.cards.map((c) => c.id),
      person: t.person,
      cards: t.cards,
      at: t.at,
    })),
  ]);
}
