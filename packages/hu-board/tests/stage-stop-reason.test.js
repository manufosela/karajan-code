// KJC-TSK-1606 (the maintainer, 2026-11-13): a session that ends its turn to wait for something is
// not done. Its sessions close every stop with "Me paro porque…" (the user's global rule); the board
// reads that line to tell waiting for the person, waiting for a process, and nothing left to do.
import { describe, expect, it } from 'vitest';

import { stopLine, waitOf } from '../src/stop-reason.js';

describe('waitOf', () => {
  it('waits for the person when the reason asks them for something', () => {
    expect(waitOf('Me paro porque espero tu respuesta sobre el atril.')).toBe('person');
    expect(waitOf('Me paro porque necesito que apruebes el sello en tu terminal.')).toBe('person');
    expect(waitOf('Me paro porque espero tu respuesta y a que la PR termine su CI, que me avisará.')).toBe('person');
  });

  it('waits for a process when it waits for one to end', () => {
    expect(waitOf('Me paro porque espero a que la PR del atril termine su CI, que me avisará.')).toBe('process');
    expect(waitOf('Me paro por el merge, que corre en segundo plano.')).toBe('process');
  });

  it('nothing to wait for when no work is left, or there is no stop line', () => {
    expect(waitOf('Me paro porque no me queda trabajo en este carril.')).toBeNull();
    expect(waitOf('Me paro porque no queda trabajo pendiente.')).toBeNull();
    expect(waitOf('Hecho, mergeado.')).toBeNull();
    expect(waitOf(null)).toBeNull();
  });
});

describe('stopLine', () => {
  it('the last "Me paro por…" line of an answer, cut at its end', () => {
    expect(stopLine('Resumen.\n\nMe paro porque espero tu respuesta.\n')).toBe('Me paro porque espero tu respuesta.');
    expect(stopLine('Me paro por A.\nMás.\nMe paro por B.')).toBe('Me paro por B.');
    expect(stopLine('sin línea')).toBeNull();
  });
});
