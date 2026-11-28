// KJC-TSK-1815 (decided by the maintainer on 2026-11-27): each of Karajan's pieces is his robot in
// costume; Ledger, Gates and Sonar came in KJC-TSK-1819, TDD in KJC-TSK-1816.
export const PIECE_COSTUMES = Object.freeze({
  tdd: { name: 'inspector', parts: ['hivis', 'trafficlight'] },
  ledger: { name: 'accountant', parts: ['eyeshade', 'waistcoat', 'book'] },
  gates: { name: 'doorman', parts: ['cap', 'greatcoat', 'barrier'] },
  sonar: { name: 'radar operator', parts: ['headphones', 'radar'] },
  sentinel: { name: 'detective', parts: ['trenchcoat', 'hat', 'magnifier'] },
  steward: { name: 'butler', parts: ['tailcoat', 'tray'] },
  review: { name: 'judge', parts: ['robe', 'jabot', 'gavel'] },
});

/** Which hand holds each prop. */
export const HELD_PROPS = Object.freeze({
  magnifier: 'right', gavel: 'right', barrier: 'right', radar: 'right', tray: 'left', book: 'left', trafficlight: 'left',
});

/** The costume piece `id` wears, or null when it is not dressed yet. */
export const costumeOfPiece = (id) => PIECE_COSTUMES[id] ?? null;
