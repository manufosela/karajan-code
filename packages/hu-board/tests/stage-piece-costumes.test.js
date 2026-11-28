// KJC-TSK-1815 (decided by the maintainer on 2026-11-27): "everything that is Karajan must be the
// Karajan figure": the pieces are Karajan's robot in costume. The meshes are three.js (checked in the
// browser); here, who wears what, and that the legend tells it.
import { describe, expect, it } from 'vitest';

import { HELD_PROPS, PIECE_COSTUMES, costumeOfPiece } from '../public/stage/piece-costumes.js';
import { CARDS } from '../public/stage/legend.js';
import { cardsIn } from '../public/stage/legend-es.js';
import { STATIONS } from '../public/stage/layout.js';

describe('the pieces in costume', () => {
  it('dresses the Sentinel as a detective, the Steward as a butler and the review as a judge', () => {
    expect(costumeOfPiece('sentinel')).toEqual({ name: 'detective', parts: ['trenchcoat', 'hat', 'magnifier'] });
    expect(costumeOfPiece('steward')).toEqual({ name: 'butler', parts: ['tailcoat', 'tray'] });
    expect(costumeOfPiece('review')).toEqual({ name: 'judge', parts: ['robe', 'jabot', 'gavel'] });
  });

  // KJC-TSK-1819: the Ledger as an accountant, the Gates as a doorman, Sonar as a radar operator.
  it('dresses the Ledger as an accountant, the Gates as a doorman and Sonar as a radar operator', () => {
    expect(costumeOfPiece('ledger')).toEqual({ name: 'accountant', parts: ['eyeshade', 'waistcoat', 'book'] });
    expect(costumeOfPiece('gates')).toEqual({ name: 'doorman', parts: ['cap', 'greatcoat', 'barrier'] });
    expect(costumeOfPiece('sonar')).toEqual({ name: 'radar operator', parts: ['headphones', 'radar'] });
  });

  it('only dresses pieces of the floor, and leaves the others as they are until their turn', () => {
    for (const id of Object.keys(PIECE_COSTUMES)) expect(STATIONS).toContain(id);
    expect(costumeOfPiece('karagan')).toBeNull();
    // KJC-TSK-1816: with TDD, every piece of the floor is Karajan in costume.
    for (const id of STATIONS) expect(costumeOfPiece(id)).not.toBeNull();
  });

  // #5002: a prop hung below the hand went into the floor. Every prop says which hand holds it, at most
  // one per hand, and the mesh stands it on that hand (its lowest point at the hand, never below).
  it('puts every prop in a hand, one per hand', () => {
    for (const { parts } of Object.values(PIECE_COSTUMES)) {
      const hands = parts.filter((p) => p in HELD_PROPS).map((p) => HELD_PROPS[p]);
      for (const hand of hands) expect(['left', 'right']).toContain(hand);
      expect(new Set(hands).size).toBe(hands.length);
    }
    for (const prop of ['magnifier', 'tray', 'gavel', 'book', 'barrier', 'radar', 'trafficlight']) expect(HELD_PROPS).toHaveProperty(prop);
  });

  it('tells each costume in the legend, in English and Spanish', () => {
    const marks = (cards, id) => cards.find((c) => c.id === id).marks.map((m) => `${m.mark} ${m.means}`).join(' ').toLowerCase();
    const words = { sentinel: [['trench', 'magnif'], ['gabardina', 'lupa']], steward: [['butler', 'tray'], ['mayordomo', 'bandeja']], review: [['judge', 'gavel'], ['juez', 'mazo']],
      ledger: [['accountant', 'book'], ['contable', 'libro']], gates: [['doorman', 'barrier'], ['portero', 'barrera']],
      sonar: [['headphones', 'radar'], ['auriculares', 'radar']] };
    for (const [id, [en, es]] of Object.entries(words)) {
      for (const w of en) expect(marks(CARDS, id)).toContain(w);
      for (const w of es) expect(marks(cardsIn('es'), id)).toContain(w);
    }
  });
});
