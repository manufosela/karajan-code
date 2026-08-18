// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff } from '../src/diff.js';
import { CONTRACT_TYPES, extractContractTokens, findContractMatches } from '../src/contracts.js';

/** Diff que renombra un endpoint: la línea QUITADA es la que rompe al consumidor. */
const HTTP_DIFF = `diff --git a/src/routes.js b/src/routes.js
index 1111111..2222222 100644
--- a/src/routes.js
+++ b/src/routes.js
@@ -10,3 +10,3 @@ export const mount = (app) => {
-  app.get('/api/v1/users/:id', getUser);
+  app.get('/api/v2/users/:id', getUser);
   app.post('/api/v1/orders', createOrder);
`;

const OPENAPI_DIFF = `diff --git a/openapi.yaml b/openapi.yaml
index 3333333..4444444 100644
--- a/openapi.yaml
+++ b/openapi.yaml
@@ -20,6 +20,6 @@ paths:
-  /billing/invoices:
+  /billing/statements:
     get:
       summary: List invoices
`;

const EVENT_DIFF = `diff --git a/src/events.js b/src/events.js
index 5555555..6666666 100644
--- a/src/events.js
+++ b/src/events.js
@@ -5,4 +5,4 @@ import { bus } from './bus.js';
-  bus.publish('order.placed', payload);
+  bus.publish('order.submitted', payload);
   bus.emit('CART_UPDATED', cart);
`;

const SQL_DIFF = `diff --git a/migrations/007_drop.sql b/migrations/007_drop.sql
index 7777777..8888888 100644
--- a/migrations/007_drop.sql
+++ b/migrations/007_drop.sql
@@ -1,3 +1,3 @@
-ALTER TABLE customer_invoices ADD COLUMN paid_at timestamptz;
+ALTER TABLE customer_statements ADD COLUMN paid_at timestamptz;
 SELECT id FROM legacy_accounts;
`;

const NOISE_DIFF = `diff --git a/src/util.js b/src/util.js
index 9999999..aaaaaaa 100644
--- a/src/util.js
+++ b/src/util.js
@@ -1,2 +1,2 @@
-export const id = 1;
+export const id = 2;
`;

const chunksOf = (diff, repoName = 'repo-a') => parseUnifiedDiff(diff, { repoName });
const values = (tokens, type) =>
  tokens.filter((t) => t.type === type).map((t) => t.value);

test('CONTRACT_TYPES son los tres de la v1', () => {
  assert.deepEqual([...CONTRACT_TYPES], ['http', 'event', 'sql']);
});

test('http: extrae rutas de definiciones, incluidas las QUITADAS', () => {
  const tokens = extractContractTokens(chunksOf(HTTP_DIFF));
  const http = values(tokens, 'http');
  assert.ok(http.includes('/api/v1/users/:id'), 'la ruta eliminada es la que rompe al consumidor');
  assert.ok(http.includes('/api/v2/users/:id'));
  const removed = tokens.find((t) => t.value === '/api/v1/users/:id');
  assert.equal(removed.removed, true);
});

test('un identificador en añadidas Y quitadas no es rotura: sigue vigente', () => {
  // La misma ruta se reubica dentro del hunk: no se rompe nada.
  const moved = `diff --git a/src/routes.js b/src/routes.js
index 1111111..2222222 100644
--- a/src/routes.js
+++ b/src/routes.js
@@ -1,4 +1,4 @@
-  app.get('/api/v1/users/:id', getUser);
   app.use(auth);
+  app.get('/api/v1/users/:id', getUser);
`;
  const [token] = extractContractTokens(chunksOf(moved));
  assert.equal(token.value, '/api/v1/users/:id');
  assert.equal(token.removed, false, 'sigue existiendo tras el cambio');
});

test('http: extrae paths de OpenAPI', () => {
  const http = values(extractContractTokens(chunksOf(OPENAPI_DIFF)), 'http');
  assert.ok(http.includes('/billing/invoices'));
  assert.ok(http.includes('/billing/statements'));
});

test('event: extrae topics de publish/emit y constantes de dominio', () => {
  const events = values(extractContractTokens(chunksOf(EVENT_DIFF)), 'event');
  assert.ok(events.includes('order.placed'));
  assert.ok(events.includes('order.submitted'));
});

test('sql: extrae tablas de ALTER y de FROM', () => {
  const sql = values(extractContractTokens(chunksOf(SQL_DIFF)), 'sql');
  assert.ok(sql.includes('customer_invoices'));
  assert.ok(sql.includes('customer_statements'));
});

test('descarta identificadores genéricos o demasiado cortos', () => {
  assert.deepEqual(extractContractTokens(chunksOf(NOISE_DIFF)), []);
});

test('cada token conserva de qué chunk salió', () => {
  const [token] = extractContractTokens(chunksOf(HTTP_DIFF));
  assert.equal(token.fromChunk.path, 'src/routes.js');
  assert.equal(typeof token.fromChunk.newStart, 'number');
});

test('matching: solo cuenta si el contenido CONTIENE el token literalmente', async () => {
  const tokens = extractContractTokens(chunksOf(HTTP_DIFF));
  const query = async () => ({
    candidates: 5,
    hits: [
      // Contiene la ruta: evidencia real.
      { source: 'repo-b/src/api-client.js', line: 42, score: 0.4,
        content: "return fetch('/api/v1/users/:id'.replace(':id', id));", sensitivity: 'internal' },
      // Sale por similitud pero NO contiene el token: no es contrato.
      { source: 'repo-c/src/users.js', line: 7, score: 0.9,
        content: 'const user = await loadUser(id);', sensitivity: 'internal' },
    ],
  });
  const { matches } = await findContractMatches({ tokens, query, excludeRepo: 'repo-a' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, 'repo-b/src/api-client.js');
  assert.equal(matches[0].tokens[0].value, '/api/v1/users/:id');
  assert.equal(matches[0].tokens[0].type, 'http');
  assert.equal(matches[0].line, 42);
});

test('matching: excluye el repo origen aunque contenga el token', async () => {
  const tokens = extractContractTokens(chunksOf(HTTP_DIFF));
  const query = async () => ({
    candidates: 3,
    hits: [
      { source: 'repo-a/src/routes.js', line: 10, score: 0.99,
        content: "app.get('/api/v1/users/:id', getUser);", sensitivity: 'internal' },
    ],
  });
  const { matches } = await findContractMatches({ tokens, query, excludeRepo: 'repo-a' });
  assert.deepEqual(matches, []);
});

test('matching: agrupa varios tokens que caen en el mismo fichero', async () => {
  const tokens = extractContractTokens(chunksOf(HTTP_DIFF));
  const query = async () => ({
    candidates: 4,
    hits: [
      { source: 'repo-b/src/client.js', line: 3, score: 0.5,
        content: "get('/api/v1/users/:id'); post('/api/v2/users/:id');", sensitivity: 'internal' },
    ],
  });
  const { matches } = await findContractMatches({ tokens, query, excludeRepo: 'repo-a' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tokens.length, 2);
});

test('sin tokens: resultado vacío explícito, sin consultar el corpus', async () => {
  let called = false;
  const query = async () => {
    called = true;
    return { hits: [], candidates: 0 };
  };
  const { matches, tokensSearched } = await findContractMatches({
    tokens: [], query, excludeRepo: 'repo-a',
  });
  assert.deepEqual(matches, []);
  assert.equal(tokensSearched, 0);
  assert.equal(called, false);
});
