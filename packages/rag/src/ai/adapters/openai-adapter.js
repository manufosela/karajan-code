// @ts-check

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} OpenAIOptions
 * @property {string} [apiKey] Default desde env OPENAI_API_KEY.
 * @property {string} [model] Default 'gpt-4o-mini'.
 * @property {string} [baseUrl] Default 'https://api.openai.com/v1' (útil para gateways compatibles).
 * @property {number} [maxTokens] Default 1024.
 * @property {typeof fetch} [fetchImpl] Inyectable para tests.
 */

/**
 * Adapter OpenAI público vía HTTP (Chat Completions, sin SDK), siguiendo
 * el patrón de runAzureOpenAi. Proveedor PÚBLICO: en la sensitivity
 * policy por defecto solo participa en el nivel `public` — nunca recibe
 * contenido confidential/internal.
 *
 * @param {string} prompt
 * @param {OpenAIOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runOpenAi(prompt, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? 'gpt-4o-mini';
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const maxTokens = options.maxTokens ?? 1024;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!apiKey) {
    throw new Error('OpenAI: falta apiKey (vía opts o env OPENAI_API_KEY).');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('OpenAI: fetch no disponible.');
  }

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });

  const stdout = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      provider: 'openai',
      process: {
        stdout,
        stderr: `HTTP ${response.status} ${response.statusText}`,
        exitCode: 1,
        signal: null,
        timedOut: false,
      },
      parsedOutput: { format: 'text', json: null, text: stdout },
      providerMeta: { model },
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
    provider: 'openai',
    process: { stdout, stderr: '', exitCode: 0, signal: null, timedOut: false },
    parsedOutput: {
      format: 'json',
      json: { answer: content, raw: json },
      text: content,
    },
    providerMeta: { model, usage: json?.usage ?? null },
  };
}
