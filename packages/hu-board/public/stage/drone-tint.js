// KJC-TSK-1701, 1713, 1818: each piece's colour; its pedestal wears it (the drones are gone). Pure.

/** Each piece's colour. */
export const DRONE_TINT = { tdd: 0x3fb950, sonar: 0x4e9bd8, steward: 0xb07cd8, ledger: 0xe8b04b, gates: 0xe07a5f };
/** The Sentinel's colour, its guard's gold. */
export const SENTINEL_TINT = 0xd4a017;

/** The colour of a piece's pedestal: the piece's own; null for a piece with none (it keeps its kind's). */
export const plinthTint = (id) => (id === 'sentinel' ? SENTINEL_TINT : DRONE_TINT[id] ?? null);
