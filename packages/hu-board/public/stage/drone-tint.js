// KJC-TSK-1701, 1707: each piece's drone colour, so its drone is known for whose it is.
// KJC-TSK-1713 (the maintainer, 2026-11-21): its pedestal wears the same colour. Pure.

/** Each piece's colour. */
export const DRONE_TINT = { tdd: 0x3fb950, sonar: 0x4e9bd8, steward: 0xb07cd8, ledger: 0xe8b04b, gates: 0xe07a5f };
/** The Sentinel's drone, in its guard's gold. */
export const SENTINEL_TINT = 0xd4a017;

/** The colour of a piece's pedestal: its drone's; null for a piece with no drone (it keeps its kind's). */
export const plinthTint = (id) => (id === 'sentinel' ? SENTINEL_TINT : DRONE_TINT[id] ?? null);
