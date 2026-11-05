// KJC-TSK-1397 (ADR 0046): the board carries a copy of the landing film's cast
// and of its three.js bundle. A copy that drifts from its original fails here,
// naming the file: change the landing, then copy it again.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILM = join(here, '..', '..', '..', 'apps', 'landing', 'public');
const STAGE = join(here, '..', 'public', 'stage');

const PIECES = ['tdd', 'sentinel', 'review', 'gates', 'sonar', 'ledger', 'steward'];
const COPIED = [
  ['lib/three.min.js', 'three.min.js'],
  ...['robot', 'robot-head', 'parts', 'piece', 'stand', 'props', 'stage', 'stage-fx'].map((m) => [`film/${m}.js`, `cast/${m}.js`]),
  ...PIECES.map((p) => [`film/pieces/${p}.js`, `cast/pieces/${p}.js`]),
];
// The film's script moves the cast by time; the stage has its own director.
const FILM_ONLY = ['score', 'timeline', 'camera', 'cast', 'main', 'framing'];

describe('the stage cast is a checked copy of the landing film', () => {
  it.each(COPIED)('%s is copied unchanged', (original, copy) => {
    expect(existsSync(join(STAGE, copy)), `${copy} is missing from the board`).toBe(true);
    const same = readFileSync(join(FILM, original)).equals(readFileSync(join(STAGE, copy)));
    expect(same, `${copy} differs from apps/landing/public/${original}: copy it again`).toBe(true);
  });

  it('leaves the film script out', () => {
    for (const m of FILM_ONLY) expect(existsSync(join(STAGE, 'cast', `${m}.js`)), m).toBe(false);
  });
});
