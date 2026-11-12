// KJC-TSK-1549 (ADR 0054, slice 2): the lots of the map, own and the teammates'. Each teammate of
// a factory with cards in progress gets a lot of its own right after it: a workshop per card,
// drawn as the last known state, nothing live. The board sends them as `team` (stage-team.js).
// Pure: map.js packs and draws these.

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
