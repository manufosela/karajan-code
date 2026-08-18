// @ts-check

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} AzureOpenAIOptions
 * @property {string} [endpoint] "https://your.openai.azure.com". Default desde env AZURE_OPENAI_ENDPOINT.
 * @property {string} [apiKey] Default desde env AZURE_OPENAI_API_KEY.
 * @property {string} [deployment] Nombre del deployment en Azure.
 * @property {string} [apiVersion] Default '2024-02-15-preview'.
 * @property {number} [maxTokens] Default 1024.
 * @property {typeof fetch} [fetchImpl] Inyectable para tests.
 */

/**
 * Adapter Azure OpenAI vía HTTP (sin SDK). Compatible con la convención
 * Chat Completions. Requiere endpoint + deployment + apiKey.
 *
 * @param {string} prompt
 * @param {AzureOpenAIOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runAzureOpenAi(prompt, options = {}) {
  const endpoint = options.endpoint ?? process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = options.apiKey ?? process.env.AZURE_OPENAI_API_KEY;
  const deployment = options.deployment ?? process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = options.apiVersion ?? '2024-02-15-preview';
  const maxTokens = options.maxTokens ?? 1024;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      'AzureOpenAI: faltan endpoint/apiKey/deployment (vía opts o env AZURE_OPENAI_*).',
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('AzureOpenAI: fetch no disponible.');
  }

  const url = `${endpoint.replace(/\/+$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const body = JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
  });
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body,
  });

  const stdout = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      provider: 'azure-openai',
      process: {
        stdout,
        stderr: `HTTP ${response.status} ${response.statusText}`,
        exitCode: 1,
        signal: null,
        timedOut: false,
      },
      parsedOutput: { format: 'text', json: null, text: stdout },
      providerMeta: { deployment, apiVersion },
    };
  }
  /** @type {any} */
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = null;
  }
  const content = json?.choices?.[0]?.message?.content ?? stdout;
  return {
    provider: 'azure-openai',
    process: {
      stdout,
      stderr: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
    },
    parsedOutput: {
      format: 'json',
      json: { answer: content, raw: json },
      text: content,
    },
    providerMeta: {
      deployment,
      apiVersion,
      usage: json?.usage ?? null,
    },
  };
}
