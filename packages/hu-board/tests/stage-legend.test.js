// KJC-TSK-1616 (asked by the maintainer on 2026-11-14): "a legend of the characters: a button in
// the factory that presents them all, what they do, when they come out, when they are called,
// what their colour, their halo, their backpack and the black line on their head mean. A bit
// like collectable cards."
import { describe, expect, it } from 'vitest';

import { CARDS, KINDS, legendSections } from '../public/stage/legend.js';
import { STATIONS } from '../public/stage/layout.js';

const byId = Object.fromEntries(CARDS.map((card) => [card.id, card]));

describe('the cast legend', () => {
  it('one card per character, each with its name, its kind, and what it does, when it comes out and who calls it', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const card of CARDS) {
      expect(Object.keys(KINDS)).toContain(card.kind);
      for (const field of ['name', 'does', 'when', 'calledBy']) expect(card[field], `${card.id}.${field}`).toMatch(/\S/);
      for (const mark of card.marks) {
        expect(mark.mark).toMatch(/\S/);
        expect(mark.means).toMatch(/\S/);
      }
    }
  });

  it('every piece of the method at its post has its card', () => {
    for (const id of STATIONS) expect(byId[id], id).toBeDefined();
  });

  it('every agent the factory draws has its card: the host, a teammate\'s host, the coder, Solomon and a subagent', () => {
    for (const id of ['host', 'teammate', 'coder', 'solomon', 'subagent']) expect(byId[id]?.kind, id).toBe('agent');
  });

  it('the crew and the things of the hall have theirs: Karajan, kaRAGan, kaWATCHan, atril, the courier, the mailbox and the release', () => {
    for (const id of ['conductor', 'rag', 'watch', 'atril', 'courier', 'mailbox', 'wall', 'release', 'drone']) expect(byId[id], id).toBeDefined();
  });

  it('the host\'s card tells its colour, its hologram, its backpack and its waiting label', () => {
    const marks = byId.host.marks.map((m) => m.mark.toLowerCase()).join(' | ');
    for (const word of ['colour', 'hologram', 'backpack', 'chest', 'label']) expect(marks).toContain(word);
  });

  it('the wardrobe card tells what each model wears on its head, the headphones among them, and what the build means', () => {
    const marks = byId.wardrobe.marks.map((m) => `${m.mark} ${m.means}`.toLowerCase()).join(' | ');
    for (const word of ['fable', 'opus', 'sonnet', 'haiku', 'headphones', 'effort']) expect(marks).toContain(word);
  });
});

// KJC-TSK-1617: the Cast dialog shows the cards in sections, one per kind, in the kinds' order.
describe('legendSections', () => {
  it('one section per kind with cards, in the order of KINDS, each card once and in its own', () => {
    const sections = legendSections(CARDS);
    expect(sections.map((s) => s.kind)).toEqual(Object.keys(KINDS).filter((k) => CARDS.some((c) => c.kind === k)));
    for (const section of sections) {
      expect(section.title).toBe(KINDS[section.kind]);
      for (const card of section.cards) expect(card.kind).toBe(section.kind);
    }
    expect(sections.flatMap((s) => s.cards)).toHaveLength(CARDS.length);
  });

  it('a kind without cards leaves no empty section', () => {
    expect(legendSections([CARDS.find((c) => c.kind === 'thing')]).map((s) => s.kind)).toEqual(['thing']);
  });
});
