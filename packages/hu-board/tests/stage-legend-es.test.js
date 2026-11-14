// KJC-TSK-1626 (asked by the maintainer on 2026-11-14): "the legend, an English and Spanish option".
import { describe, expect, it } from 'vitest';

import { CARDS, KINDS } from '../public/stage/legend.js';
import { LANGS, cardsIn, kindsIn, labelsIn, langOf } from '../public/stage/legend-es.js';

describe('the legend in Spanish', () => {
  const es = cardsIn('es');

  it('every card, in the same order, with its name, its what, when and who and each mark translated', () => {
    expect(es.map((c) => c.id)).toEqual(CARDS.map((c) => c.id));
    es.forEach((card, i) => {
      for (const field of ['name', 'does', 'when', 'calledBy']) {
        expect(card[field], `${card.id}.${field}`).toMatch(/\S/);
        if (field !== 'name') expect(card[field], `${card.id}.${field}`).not.toBe(CARDS[i][field]);
      }
      expect(card.marks).toHaveLength(CARDS[i].marks.length);
      for (const mark of card.marks) expect(mark.mark).toMatch(/\S/);
    });
  });

  it('English stays as it was', () => {
    expect(cardsIn('en')).toEqual(CARDS);
    expect(kindsIn('en')).toEqual(KINDS);
  });

  it('the kinds and the panel\'s words in each language', () => {
    expect(Object.keys(kindsIn('es'))).toEqual(Object.keys(KINDS));
    for (const lang of LANGS) {
      const labels = labelsIn(lang);
      for (const key of ['title', 'close', 'does', 'when', 'calledBy', 'marks']) expect(labels[key], `${lang}.${key}`).toMatch(/\S/);
    }
    expect(labelsIn('es').does).toBe('Qué hace');
  });

  it('the language: the one chosen, else Spanish for a Spanish browser, else English', () => {
    expect(langOf('es', 'en-US')).toBe('es');
    expect(langOf(null, 'es-ES')).toBe('es');
    expect(langOf(null, 'fr')).toBe('en');
    expect(langOf('xx', 'en')).toBe('en');
  });
});
