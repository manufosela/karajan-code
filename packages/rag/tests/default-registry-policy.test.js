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

/** SDK falso de Vertex: captura el request y devuelve una respuesta dada. */
function makeFakeVertexSdk(response, capture) {
  return {
    VertexAI: class {
      getGenerativeModel() {
        return {
          async generateContent(request) {
            capture.request = request;
            return { response };
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
  assert.equal(capture.request.generationConfig.maxOutputTokens, 8192);
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
