// KJC-TSK-1659 (the maintainer, 2026-11-17): "when an agent appears in the capsule, could Karajan,
// who is beside it, press a button or similar?" A console between Karajan and the booth; Karajan
// turns to it and presses its button as someone teleports in.
import { describe, expect, it } from 'vitest';

import { BEAT_MS, PRESS_MS, buttonAt, conductorAt, withBeat } from '../public/stage/conductor.js';
import { BOOTH, CONSOLE, CREW } from '../public/stage/layout.js';

const xOf = () => 6;
const zOf = () => 2;
const facing = (to) => Math.atan2(to.x - CREW.conductor.x, to.z - CREW.conductor.z);

describe('Karajan at the booth\'s console', () => {
  it('the console stands between Karajan and the booth, within its reach', () => {
    expect(CONSOLE.x).toBeGreaterThan(CREW.conductor.x);
    expect(CONSOLE.x).toBeLessThan(BOOTH.x);
    expect(Math.hypot(CONSOLE.x - CREW.conductor.x, CONSOLE.z - CREW.conductor.z)).toBeLessThan(1.5);
  });

  it('as someone teleports in, it turns to the console and pushes its button, then rests', () => {
    const pressed = 1000;
    const at = conductorAt(null, pressed + PRESS_MS / 2, xOf, zOf, pressed);
    expect(at.yaw).toBeCloseTo(facing(CONSOLE));
    expect(at.R[1]).toBeGreaterThan(0.8); // its right hand forward, onto the button
    expect(conductorAt(null, pressed + PRESS_MS, xOf, zOf, pressed)).toEqual({ yaw: CREW.conductor.yaw, L: [0, 0], R: [0, 0] });
  });

  it('a press goes before a beat of the method; after it, the beat goes on', () => {
    const beat = withBeat(null, { type: 'commit-gate', outcome: 'pass', lane: 'x' }, 1000);
    expect(conductorAt(beat, 1100, xOf, zOf, 1050).yaw).toBeCloseTo(facing(CONSOLE));
    expect(conductorAt(beat, 1050 + PRESS_MS + 10, xOf, zOf, 1050).yaw).not.toBeCloseTo(facing(CONSOLE));
    expect(PRESS_MS).toBeLessThan(BEAT_MS);
  });

  it('the button lights while it is pressed, and is dark otherwise', () => {
    expect(buttonAt(1000, 1000 + PRESS_MS / 2)).toBeGreaterThan(0.5);
    expect(buttonAt(1000, 1000 + PRESS_MS)).toBe(0);
    expect(buttonAt(null, 5)).toBe(0);
  });
});
