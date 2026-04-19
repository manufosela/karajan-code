// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAzureOpenAi } from '../src/ai/adapters/azure-openai-adapter.js';
import { runBedrock } from '../src/ai/adapters/bedrock-adapter.js';
import { runVertexAi } from '../src/ai/adapters/vertex-ai-adapter.js';
import {
  createDefaultSensitivityPolicy,
  isProviderAllowed,
} from '../src/policy/sensitivity-policy.js';

function mockFetch(handler) {
  return async (url, init) => {
    const out = handler(String(url), init ?? {});
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      statusText: `Mock ${out.status}`,
      async text() {
        return typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
      },
    };
  };
}

test('runAzureOpenAi: 200 devuelve AdapterResult con answer extraído', async () => {
  let capturedUrl = null;
  let capturedHeaders = null;
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return {
      status: 200,
      body: {
        choices: [{ message: { content: 'respuesta Azure' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    };
  });
  const res = await runAzureOpenAi('hola', {
    endpoint: 'https://test.openai.azure.com',
    apiKey: 'secret',
    deployment: 'my-dep',
    fetchImpl,
  });
  assert.equal(res.provider, 'azure-openai');
  assert.equal(res.parsedOutput.text, 'respuesta Azure');
  assert.match(capturedUrl, /openai\/deployments\/my-dep\/chat\/completions/);
  assert.equal(capturedHeaders['api-key'], 'secret');
  assert.equal(res.providerMeta.deployment, 'my-dep');
});

test('runAzureOpenAi: HTTP 500 devuelve AdapterResult con exitCode 1', async () => {
  const fetchImpl = mockFetch(() => ({ status: 500, body: 'server down' }));
  const res = await runAzureOpenAi('x', {
    endpoint: 'https://test.openai.azure.com',
    apiKey: 'k',
    deployment: 'd',
    fetchImpl,
  });
  assert.equal(res.process.exitCode, 1);
  assert.match(res.process.stderr, /HTTP 500/);
});

test('runAzureOpenAi: faltan credenciales lanza mensaje claro', async () => {
  await assert.rejects(() => runAzureOpenAi('x', { fetchImpl: async () => null }), /endpoint\/apiKey\/deployment/);
});

test('runBedrock: usa SDK mock y extrae content de Claude response', async () => {
  const mockClient = {
    sends: [],
    async send(cmd) {
      this.sends.push(cmd);
      const body = { content: [{ text: 'respuesta Claude via Bedrock' }], usage: { input_tokens: 5 } };
      return { body: new TextEncoder().encode(JSON.stringify(body)) };
    },
  };
  const sdk = {
    BedrockRuntimeClient: function BedrockRuntimeClientMock(cfg) {
      this.cfg = cfg;
      this.send = (cmd) => mockClient.send(cmd);
    },
    InvokeModelCommand: function InvokeModelCommandMock(input) {
      this.input = input;
    },
  };
  const res = await runBedrock('hola', {
    region: 'eu-west-1',
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    sdk,
  });
  assert.equal(res.provider, 'bedrock');
  assert.equal(res.parsedOutput.text, 'respuesta Claude via Bedrock');
  assert.equal(res.providerMeta.region, 'eu-west-1');
  assert.ok(mockClient.sends.length === 1);
});

test('runBedrock: modelo Llama usa campo "generation" en respuesta', async () => {
  const sdk = {
    BedrockRuntimeClient: function Mock() {
      this.send = async () => ({
        body: new TextEncoder().encode(JSON.stringify({ generation: 'Llama dice hola' })),
      });
    },
    InvokeModelCommand: function Cmd(input) {
      this.input = input;
    },
  };
  const res = await runBedrock('x', { modelId: 'meta.llama3-8b-instruct-v1:0', sdk });
  assert.equal(res.parsedOutput.text, 'Llama dice hola');
});

test('runBedrock: sin SDK instalado lanza con instrucción', async () => {
  await assert.rejects(
    () => runBedrock('x', { region: 'us-east-1', modelId: 'anthropic.claude-v2' }),
    /@aws-sdk\/client-bedrock-runtime/,
  );
});

test('runVertexAi: usa SDK mock y extrae text de Gemini response', async () => {
  const sdk = {
    VertexAI: function VertexMock(cfg) {
      this.cfg = cfg;
      this.getGenerativeModel = () => ({
        async generateContent(_req) {
          return {
            response: {
              candidates: [{ content: { parts: [{ text: 'hola desde Vertex' }] } }],
              usageMetadata: { totalTokenCount: 12 },
            },
          };
        },
      });
    },
  };
  const res = await runVertexAi('hola', {
    project: 'mi-proyecto',
    location: 'europe-west1',
    model: 'gemini-1.5-pro',
    sdk,
  });
  assert.equal(res.provider, 'vertex-ai');
  assert.equal(res.parsedOutput.text, 'hola desde Vertex');
  assert.equal(res.providerMeta.project, 'mi-proyecto');
  assert.equal(res.providerMeta.location, 'europe-west1');
  assert.equal(res.providerMeta.model, 'gemini-1.5-pro');
});

test('runVertexAi: sin project lanza', async () => {
  const before = process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  try {
    await assert.rejects(() => runVertexAi('x'), /project/);
  } finally {
    if (before) process.env.GOOGLE_CLOUD_PROJECT = before;
  }
});

test('createDefaultSensitivityPolicy: internal incluye los 3 nuevos providers', () => {
  const policy = createDefaultSensitivityPolicy();
  assert.ok(isProviderAllowed(policy, 'internal', 'azure-openai'));
  assert.ok(isProviderAllowed(policy, 'internal', 'bedrock'));
  assert.ok(isProviderAllowed(policy, 'internal', 'vertex-ai'));
});

test('createDefaultSensitivityPolicy: confidential NO admite cloud privados (solo ollama)', () => {
  const policy = createDefaultSensitivityPolicy();
  assert.equal(isProviderAllowed(policy, 'confidential', 'azure-openai'), false);
  assert.equal(isProviderAllowed(policy, 'confidential', 'bedrock'), false);
  assert.equal(isProviderAllowed(policy, 'confidential', 'vertex-ai'), false);
  assert.equal(isProviderAllowed(policy, 'confidential', 'ollama'), true);
});
