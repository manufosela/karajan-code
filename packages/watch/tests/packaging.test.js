// @ts-check
// El paquete publicado tiene que anunciar lo que necesita para funcionar.
//
// karajan-rag no declara dependencias: sus backends de store son peers que
// instala quien despliega. Si karajan-watch tampoco los anuncia, quien hace
// `npm i karajan-watch` se encuentra con que NINGÚN store funciona — que es
// exactamente lo que pasaba antes de KJW-TSK-0023.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

/** Backend de cada store desplegable, tal y como lo carga karajan-rag. */
const STORE_PEERS = Object.freeze({
  lancedb: '@lancedb/lancedb',
  pgvector: 'pg',
});

test('declara el backend de cada store desplegable como peer', () => {
  for (const [store, peer] of Object.entries(STORE_PEERS)) {
    assert.ok(
      pkg.peerDependencies?.[peer],
      `el store "${store}" necesita "${peer}" y el paquete no lo declara`,
    );
  }
});

test('los peers de store son opcionales: cada quien instala el suyo', () => {
  for (const peer of Object.values(STORE_PEERS)) {
    assert.equal(
      pkg.peerDependenciesMeta?.[peer]?.optional,
      true,
      `"${peer}" debe ser opcional: exigir los dos obligaría a instalar un ` +
        'backend nativo a quien solo usa el otro',
    );
  }
});
