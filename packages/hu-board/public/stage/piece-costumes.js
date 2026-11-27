// KJC-TSK-1815 (decided by the maintainer on 2026-11-27): each of Karajan's pieces is his robot in
// costume; Ledger, Gates and Sonar come in KJC-TSK-1819, TDD in KJC-TSK-1816.
export const PIECE_COSTUMES = Object.freeze({
  sentinel: { name: 'detective', parts: ['trenchcoat', 'hat', 'magnifier'] },
  steward: { name: 'butler', parts: ['tailcoat', 'tray'] },
  review: { name: 'judge', parts: ['robe', 'jabot', 'gavel'] },
});

/** The costume piece `id` wears, or null when it is not dressed yet. */
export const costumeOfPiece = (id) => PIECE_COSTUMES[id] ?? null;
