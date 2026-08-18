// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAnthropic } from '../src/ai/adapters/anthropic-adapter.js';
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

test('runAnthropic: 200 concatena bloques text y expone stop_reason/usage', async () => {
  const { calls, fetchImpl } = makeFetch(200, {
    model: 'claude-opus-4-8',
    stop_reason: 'end_turn',
    content: [
      { type: 'text', text: 'hola ' },
      { type: 'text', text: 'desde claude' },
    ],
    usage: { input_tokens: 12, output_tokens: 5 },
  });
  const res = await runAnthropic('hola', { apiKey: 'sk-ant-test', fetchImpl });
  assert.equal(res.provider, 'anthropic');
  assert.equal(res.process.exitCode, 0);
  assert.equal(/** @type {any} */ (res.parsedOutput.json).answer, 'hola desde claude');
  assert.equal(res.providerMeta.stopReason, 'end_turn');
  assert.equal(res.providerMeta.usage.output_tokens, 5);

  const call = calls[0];
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, 'claude-opus-4-8');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hola' }]);
});

test('runAnthropic: error HTTP produce exitCode 1 con stderr explícito', async () => {
  const { fetchImpl } = makeFetch(401, { type: 'error', error: { type: 'authentication_error' } });
  const res = await runAnthropic('hola', { apiKey: 'sk-mal', fetchImpl });
  assert.equal(res.process.exitCode, 1);
  assert.match(res.process.stderr, /HTTP 401/);
});

test('runAnthropic: sin apiKey lanza; baseUrl y model configurables', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      () => runAnthropic('hola', { fetchImpl: /** @type {never} */ (async () => {}) }),
      /ANTHROPIC_API_KEY/,
    );
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
  const { calls, fetchImpl } = makeFetch(200, { content: [] });
  await runAnthropic('h', {
    apiKey: 'k',
    fetchImpl,
    baseUrl: 'https://gateway.local/',
    model: 'claude-haiku-4-5',
  });
  assert.equal(calls[0].url, 'https://gateway.local/v1/messages');
  assert.equal(JSON.parse(calls[0].init.body).model, 'claude-haiku-4-5');
});

test('policy por defecto: anthropic solo en el nivel public', () => {
  const policy = createDefaultSensitivityPolicy();
  assert.equal(isProviderAllowed(policy, 'public', 'anthropic'), true);
  assert.equal(isProviderAllowed(policy, 'internal', 'anthropic'), false);
  assert.equal(isProviderAllowed(policy, 'confidential', 'anthropic'), false);
});
