// KJC-TSK-1818 (ADR "kj stage en una línea", decision 5, accepted 2026-11-27): "fuera los mensajeros
// y los demás drones". The pieces no longer send drones to the lanes: they light or flash at their own
// place (TDD walks to the coder's desk himself). Only the release drone and, later, the wall's stay.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CARDS } from '../public/stage/legend.js';
import { cardsIn } from '../public/stage/legend-es.js';

const stage = (file) => new URL(`../public/stage/${file}`, import.meta.url);
const PIECES = ['sentinel', 'gates', 'sonar', 'ledger', 'steward', 'tdd'];
const told = (card) => [card.does, card.when, card.calledBy, ...card.marks.flatMap((m) => [m.mark, m.means])].join(' ').toLowerCase();

describe('no piece drones', () => {
  it('has no piece drone to build or fly', () => {
    for (const file of ['piece-drone.js', 'piece-drone-mesh.js']) expect(existsSync(stage(file)), file).toBe(false);
  });

  it('the legend tells no piece sending a drone, in English or Spanish', () => {
    for (const id of PIECES) {
      expect(told(CARDS.find((c) => c.id === id)), id).not.toMatch(/drone/);
      expect(told(cardsIn('es').find((c) => c.id === id)), id).not.toMatch(/\bdron/);
    }
  });

  it('keeps the release drone', () => {
    expect(CARDS.find((c) => c.id === 'drone')).toBeDefined();
  });
});
