// @ts-check

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} BedrockOptions
 * @property {string} [region] AWS region (default env AWS_REGION o 'us-east-1').
 * @property {string} [modelId] p.ej. 'anthropic.claude-3-haiku-20240307-v1:0'.
 * @property {number} [maxTokens] Default 1024.
 * @property {any} [sdk] Módulo @aws-sdk/client-bedrock-runtime inyectable en tests.
 */

/**
 * Adapter AWS Bedrock vía SDK oficial. SigV4 y credenciales las gestiona el
 * SDK (SSO, env vars, IAM role…). @aws-sdk/client-bedrock-runtime es
 * peer-dependency opcional; si no está instalado lanza mensaje instructivo.
 *
 * @param {string} prompt
 * @param {BedrockOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runBedrock(prompt, options = {}) {
  const region = options.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const modelId = options.modelId ?? 'anthropic.claude-3-haiku-20240307-v1:0';
  const maxTokens = options.maxTokens ?? 1024;
  const sdk = options.sdk ?? (await loadBedrockSdk());

  const { BedrockRuntimeClient, InvokeModelCommand } = sdk;
  const client = new BedrockRuntimeClient({ region });

  const body = buildRequestBody(modelId, prompt, maxTokens);
  const cmd = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(body)),
  });

  const response = await client.send(cmd);
  const rawBody = response.body
    ? new TextDecoder().decode(response.body)
    : '';
  /** @type {any} */
  let json;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = null;
  }
  const text = extractBedrockText(modelId, json);
  return {
    provider: 'bedrock',
    process: {
      stdout: rawBody,
      stderr: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
    },
    parsedOutput: {
      format: 'json',
      json: { answer: text, raw: json },
      text,
    },
    providerMeta: {
      modelId,
      region,
      usage: json?.usage ?? null,
    },
  };
}

/**
 * @param {string} modelId
 * @param {string} prompt
 * @param {number} maxTokens
 */
function buildRequestBody(modelId, prompt, maxTokens) {
  if (modelId.startsWith('anthropic.claude')) {
    return {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
  }
  if (modelId.startsWith('meta.llama')) {
    return { prompt, max_gen_len: maxTokens };
  }
  if (modelId.startsWith('mistral')) {
    return { prompt, max_tokens: maxTokens };
  }
  // Fallback genérico
  return { prompt, max_tokens: maxTokens };
}

/**
 * @param {string} modelId
 * @param {any} json
 * @returns {string}
 */
function extractBedrockText(modelId, json) {
  if (!json) return '';
  if (modelId.startsWith('anthropic.claude')) {
    return json.content?.[0]?.text ?? '';
  }
  if (modelId.startsWith('meta.llama')) {
    return json.generation ?? '';
  }
  if (modelId.startsWith('mistral')) {
    return json.outputs?.[0]?.text ?? '';
  }
  return json.completion ?? json.text ?? '';
}

async function loadBedrockSdk() {
  try {
    return await import('@aws-sdk/client-bedrock-runtime');
  } catch (err) {
    throw new Error(
      "Bedrock adapter requiere '@aws-sdk/client-bedrock-runtime'. Instala con: pnpm add @aws-sdk/client-bedrock-runtime",
      { cause: err },
    );
  }
}
