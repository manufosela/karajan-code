// KJC-TSK-1814 (the maintainer, 2026-11-27): "it must be a figure other than Karajan's, that is
// fundamental; then we can use full colours for them, by the agent in use, for every one Karajan has".
// The figure itself is three.js (agent-figure.js), checked in the browser; here, its colours and the
// shape it keeps so that what dresses and seats a robot fits it too.
import { describe, expect, it } from 'vitest';

import { AGENT_COLOURS, UNKNOWN_AGENT, accentOf as colourOf } from '../public/stage/agent-colours.js';
import { FIGURE } from '../public/stage/agent-figure-shape.js';
import { CARDS } from '../public/stage/legend.js';
import { cardsIn } from '../public/stage/legend-es.js';
import { accentOf } from '../public/stage/workers.js';

const NINE = ['claude', 'codex', 'agy', 'gemini', 'aider', 'copilot', 'kimi', 'opencode', 'qwen'];

describe('each agent in a colour of its own', () => {
  it('has one for every agent kj can run, none of them the same', () => {
    expect(Object.keys(AGENT_COLOURS).toSorted()).toEqual(NINE.toSorted());
    expect(new Set(NINE.map(colourOf)).size).toBe(NINE.length);
    expect(NINE.map(accentOf)).toEqual(NINE.map(colourOf)); // the one the floor paints with
  });

  it('keeps the colours the board already showed, and a grey for an agent it does not know', () => {
    expect([colourOf('claude'), colourOf('codex'), colourOf('agy')]).toEqual([0xd97757, 0x9aa4ff, 0x7ee0b5]);
    expect(colourOf('someone-new')).toBe(UNKNOWN_AGENT);
    expect(NINE.map(colourOf)).not.toContain(UNKNOWN_AGENT);
  });

  it('is never too close to another, so two agents side by side are told apart', () => {
    const rgb = (c) => [c >> 16, (c >> 8) & 0xff, c & 0xff];
    const apart = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
    for (const a of NINE) for (const b of NINE) if (a < b) expect(apart(colourOf(a), colourOf(b))).toBeGreaterThan(60);
  });
});

describe('the legend tells the figure apart', () => {
  it('names every agent\'s colour and says it is not Karajan, in English and Spanish', () => {
    const coder = (cards) => cards.find((c) => c.id === 'coder').marks.map((m) => m.means).join(' ').toLowerCase();
    for (const text of [coder(CARDS), coder(cardsIn('es'))]) {
      for (const agent of NINE) expect(text).toContain(agent);
      expect(text).toContain('karajan');
    }
  });
});

describe('the agent figure keeps the robot\'s frame', () => {
  it('has its head where the robot has it, no wider, so the models\' attire and the crown sit on it', () => {
    expect(FIGURE.head.y).toBe(2.4);
    expect(FIGURE.head.width).toBeLessThanOrEqual(2.52);
    expect(FIGURE.head.width / 2).toBeLessThan(1.02); // the headphones' cups (attire.js)
    expect(FIGURE.head.depth / 2).toBeLessThan(0.97); // the glasses' lenses
    expect(FIGURE.head.height / 2).toBeGreaterThanOrEqual(0.9 - 0.28 / 2); // the crown's band rests on it
  });

  it('has its shoulders where the robot has them, so it types and holds its cup the same', () => {
    expect(FIGURE.shoulder).toEqual({ x: 0.8, y: 1.12 });
  });

  it('fits inside the king\'s robe and before its backpack, and stands on its legs where Karajan floats', () => {
    expect(FIGURE.body.radius).toBeLessThan(0.72); // the robe's collar (costume-mesh.js)
    expect(FIGURE.body.radius).toBeLessThan(1 - 0.6 / 2); // the backpack's front (backpack.js)
    expect(FIGURE.legs.height).toBeGreaterThan(0);
    expect(FIGURE.body.bottom).toBeCloseTo(FIGURE.legs.height);
  });
});
