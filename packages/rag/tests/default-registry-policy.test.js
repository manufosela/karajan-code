// @ts-check
// KJR-BUG-0011 (issue #155): el registry por defecto no registraba ningún
// adapter permitido por la política de sensibilidad por defecto — un índice
// con DEFAULT_SENSITIVITY=internal se quedaba sin adapter utilizable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAdapterRegistry } from '../src/ai/adapter-registry.js';
import { createDefaultSensitivityPolicy } from '../src/policy/sensitivity-policy.js';
import { runVertexAi } from '../src/ai/adapters/vertex-ai-adapter.js';

test('todo provider que nombra la política por defecto está registrado en el registry por defecto', async () => {
  const registry = await createDefaultAdapterRegistry();
  const policy = createDefaultSensitivityPolicy();
  for (const [level, providers] of Object.entries(policy)) {
    for (const provider of providers) {
      assert.ok(
        registry.has(provider),
        `nivel "${level}": provider "${provider}" permitido por la política pero NO registrado`,
      );
    }
    assert.ok(providers.length > 0, `nivel "${level}" sin providers`);
  }
});

/** SDK falso (Google Gen AI, KJR-TSK-0159): captura init y request. */
function makeFakeVertexSdk(response, capture) {
  return {
    GoogleGenAI: class {
      constructor(init) {
        capture.init = init;
        this.models = {
          generateContent: async (request) => {
            capture.request = request;
            return response;
          },
        };
      }
    },
  };
}

test('vertex: el modelo por defecto es gemini-2.5-flash (1.5/2.0 retirados: 404)', async () => {
  const capture = {};
  const sdk = makeFakeVertexSdk(
    { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    capture,
  );
  const result = await runVertexAi('hola', { project: 'p', sdk });
  assert.equal(result.providerMeta.model, 'gemini-2.5-flash');
});

test('vertex: maxTokens por defecto 8192 — 1024 deja sin salida a los modelos que razonan', async () => {
  const capture = {};
  const sdk = makeFakeVertexSdk(
    { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    capture,
  );
  await runVertexAi('hola', { project: 'p', sdk });
  assert.equal(capture.request.config.maxOutputTokens, 8192);
});

test('vertex: el Gen AI SDK arranca en modo vertexai con project y location', async () => {
  const capture = {};
  const sdk = makeFakeVertexSdk(
    { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    capture,
  );
  await runVertexAi('hola', { project: 'p', location: 'europe-west1', sdk });
  assert.equal(capture.init.vertexai, true);
  assert.equal(capture.init.project, 'p');
  assert.equal(capture.init.location, 'europe-west1');
});

test('vertex: VERTEX_MODEL y VERTEX_LOCATION del entorno como fallback — options gana, env después, default al final', async () => {
  const capture = {};
  const sdk = makeFakeVertexSdk(
    { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    capture,
  );
  process.env.VERTEX_MODEL = 'gemini-2.5-pro';
  process.env.VERTEX_LOCATION = 'europe-west4';
  try {
    const viaEnv = await runVertexAi('hola', { project: 'p', sdk });
    assert.equal(viaEnv.providerMeta.model, 'gemini-2.5-pro');
    assert.equal(viaEnv.providerMeta.location, 'europe-west4');
    const viaOptions = await runVertexAi('hola', { project: 'p', model: 'otro', location: 'us-east1', sdk });
    assert.equal(viaOptions.providerMeta.model, 'otro');
    assert.equal(viaOptions.providerMeta.location, 'us-east1');
  } finally {
    delete process.env.VERTEX_MODEL;
    delete process.env.VERTEX_LOCATION;
  }
});

test('vertex: respuesta vacía con finishReason MAX_TOKENS falla con mensaje explícito, no con JSON vacío', async () => {
  const capture = {};
  const sdk = makeFakeVertexSdk(
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] },
    capture,
  );
  await assert.rejects(
    () => runVertexAi('hola', { project: 'p', sdk, maxTokens: 64 }),
    /MAX_TOKENS.*maxTokens|maxTokens.*MAX_TOKENS/s,
  );
});
