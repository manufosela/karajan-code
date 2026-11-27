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

  // KJC-TSK-1810 (the maintainer, 2026-11-26): "a que revises" waits for the person, not for a process.
  it('waits for the person when it waits for them to do something, in the second person', () => {
    expect(waitOf('Me paro por esperar a que revises la sesión kj-stage.')).toBe('person');
    expect(waitOf('Me paro por esperar a que compruebes el board.')).toBe('person');
    expect(waitOf('Me paro por esperar a que ejecutes el script y me digas qué sale.')).toBe('person');
    expect(waitOf('Me paro porque espero a que lo pruebes en casa.')).toBe('person');
    expect(waitOf('Me paro por esperar a que estés de vuelta.')).toBe('person');
  });

  it('the third person, or a process in the plural, is still a process', () => {
    expect(waitOf('Me paro por esperar a que pase el CI.')).toBe('process');
    expect(waitOf('Me paro por esperar a que acabe el deploy.')).toBe('process');
    expect(waitOf('Me paro por esperar a que las pruebas acaben.')).toBe('process');
    expect(waitOf('Me paro por esperar a que los tests pasen.')).toBe('process');
    expect(waitOf('Me paro por esperar a que las builds terminen.')).toBe('process');
    expect(waitOf('Me paro por esperar a que las validaciones terminen.')).toBe('process');
    expect(waitOf('Me paro por esperar a que las migraciones acaben en staging.')).toBe('process');
    expect(waitOf('Me paro por esperar a que unas tareas acaben.')).toBe('process');
    // And when the subject carries an adjective or a complement before its verb.
    expect(waitOf('Me paro por esperar a que las pruebas unitarias terminen.')).toBe('process');
    expect(waitOf('Me paro por esperar a que las pruebas de integración terminen.')).toBe('process');
  });

  it('a pronoun before the verb is still the person', () => {
    expect(waitOf('Me paro por esperar a que las revises.')).toBe('person');
    expect(waitOf('Me paro por esperar a que los firmes también.')).toBe('person');
    expect(waitOf('Me paro por esperar a que la apruebes en el móvil.')).toBe('person');
    expect(waitOf('Me paro por esperar a que las revises en la imagen del examen.')).toBe('person');
    expect(waitOf('Me paro por esperar a que los firmes, cuando acaben los tests.')).toBe('person');
    expect(waitOf('Me paro por esperar a que los firmes mientras llegan los documentos.')).toBe('person');
    expect(waitOf('Me paro por esperar a que las revises si fallan otra vez.')).toBe('person');
    expect(waitOf('Me paro por esperar a que las mires hasta que terminen.')).toBe('person');
    expect(waitOf('Me paro por esperar a que los apruebes en tu móvil y en el de Jorge cuando lleguen.')).toBe('person');
  });

  it('waits for a process when it waits for one to end', () => {
    expect(waitOf('Me paro porque espero a que la PR del atril termine su CI, que me avisará.')).toBe('process');
    expect(waitOf('Me paro por el merge, que corre en segundo plano.')).toBe('process');
  });

  it('nothing to wait for when no work is left, or there is no stop line', () => {
    expect(waitOf('Me paro porque no me queda trabajo en este carril.')).toBeNull();
    expect(waitOf('Me paro porque no queda trabajo pendiente.')).toBeNull();
    // KJC-BUG-0638 (the maintainer, 2026-11-18): "it has finished, shouldn't it leave?"
    expect(waitOf('Me paro por no quedar trabajo pendiente de estos encargos.')).toBeNull();
    expect(waitOf('Me paro por no quedarme nada que hacer.')).toBeNull();
    expect(waitOf('Me paro porque ya no quedan tareas.')).toBeNull();
    expect(waitOf('Me paro por no tener más trabajo.')).toBeNull();
    // Waiting for a process still says so.
    expect(waitOf('Me paro por esperar al CI de la PR en segundo plano.')).toBe('process');
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
