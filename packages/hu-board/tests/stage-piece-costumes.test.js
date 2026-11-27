// KJC-TSK-1815 (decided by the maintainer on 2026-11-27): "everything that is Karajan must be the
// Karajan figure": the pieces are Karajan's robot in costume. The meshes are three.js (checked in the
// browser); here, who wears what, and that the legend tells it.
import { describe, expect, it } from 'vitest';

import { PIECE_COSTUMES, costumeOfPiece } from '../public/stage/piece-costumes.js';
import { CARDS } from '../public/stage/legend.js';
import { cardsIn } from '../public/stage/legend-es.js';
import { STATIONS } from '../public/stage/layout.js';

describe('the pieces in costume', () => {
  it('dresses the Sentinel as a detective, the Steward as a butler and the review as a judge', () => {
    expect(costumeOfPiece('sentinel')).toEqual({ name: 'detective', parts: ['trenchcoat', 'hat', 'magnifier'] });
    expect(costumeOfPiece('steward')).toEqual({ name: 'butler', parts: ['tailcoat', 'tray'] });
    expect(costumeOfPiece('review')).toEqual({ name: 'judge', parts: ['robe', 'jabot', 'gavel'] });
  });

  it('only dresses pieces of the floor, and leaves the others as they are until their turn', () => {
    for (const id of Object.keys(PIECE_COSTUMES)) expect(STATIONS).toContain(id);
    expect(costumeOfPiece('ledger')).toBeNull();
  });

  it('tells each costume in the legend, in English and Spanish', () => {
    const marks = (cards, id) => cards.find((c) => c.id === id).marks.map((m) => `${m.mark} ${m.means}`).join(' ').toLowerCase();
    const words = { sentinel: [['trench', 'magnif'], ['gabardina', 'lupa']], steward: [['butler', 'tray'], ['mayordomo', 'bandeja']], review: [['judge', 'gavel'], ['juez', 'mazo']] };
    for (const [id, [en, es]] of Object.entries(words)) {
      for (const w of en) expect(marks(CARDS, id)).toContain(w);
      for (const w of es) expect(marks(cardsIn('es'), id)).toContain(w);
    }
  });
});
