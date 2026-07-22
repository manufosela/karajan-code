// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOpenAi } from '../src/ai/adapters/openai-adapter.js';
import { createDefaultSensitivityPolicy, isProviderAllowed } from '../src/policy/sensitivity-policy.js';

/** @param {number} status @param {unknown} body */
function makeFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { calls, fetchImpl: /** @type {typeof fetch} */ (/** @type {unknown} */ (fetchImpl)) };
}

test('runOpenAi: 200 devuelve AdapterResult con answer extraído', async () => {
  const { calls, fetchImpl } = makeFetch(200, {
    choices: [{ message: { content: 'hola desde gpt' } }],
    usage: { total_tokens: 10 },
  });
  const res = await runOpenAi('hola', { apiKey: 'sk-test', fetchImpl, model: 'gpt-4o-mini' });
  assert.equal(res.provider, 'openai');
  assert.equal(res.process.exitCode, 0);
  assert.equal(/** @type {any} */ (res.parsedOutput.json).answer, 'hola desde gpt');
  assert.equal(res.providerMeta.usage.total_tokens, 10);

  const call = calls[0];
  assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.match(call.init.headers.Authorization, /^Bearer sk-test$/);
  assert.equal(JSON.parse(call.init.body).model, 'gpt-4o-mini');
});

test('runOpenAi: error HTTP produce exitCode 1 con stderr explícito', async () => {
  const { fetchImpl } = makeFetch(401, { error: { message: 'bad key' } });
  const res = await runOpenAi('hola', { apiKey: 'sk-mal', fetchImpl });
  assert.equal(res.process.exitCode, 1);
  assert.match(res.process.stderr, /HTTP 401/);
});

test('runOpenAi: sin apiKey lanza; baseUrl alternativa se respeta', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(() => runOpenAi('hola', { fetchImpl: /** @type {never} */ (async () => {}) }), /OPENAI_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
  const { calls, fetchImpl } = makeFetch(200, { choices: [] });
  await runOpenAi('h', { apiKey: 'k', fetchImpl, baseUrl: 'https://gateway.local/v1/' });
  assert.equal(calls[0].url, 'https://gateway.local/v1/chat/completions');
});

test('policy por defecto: openai solo en el nivel public', () => {
  const policy = createDefaultSensitivityPolicy();
  assert.equal(isProviderAllowed(policy, 'public', 'openai'), true);
  assert.equal(isProviderAllowed(policy, 'internal', 'openai'), false);
  assert.equal(isProviderAllowed(policy, 'confidential', 'openai'), false);
});
