// @ts-check

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} AnthropicOptions
 * @property {string} [apiKey] Default desde env ANTHROPIC_API_KEY.
 * @property {string} [model] Default 'claude-opus-4-8'.
 * @property {string} [baseUrl] Default 'https://api.anthropic.com'.
 * @property {number} [maxTokens] Default 1024.
 * @property {typeof fetch} [fetchImpl] Inyectable para tests.
 */

/** Versión de la Messages API (header anthropic-version obligatorio). */
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Adapter Anthropic vía HTTP (Messages API, sin SDK) — complemento a
 * runClaudeCli para entornos sin shell (Cloud Run, workers). Sigue el
 * patrón de los demás adapters HTTP del paquete (fetch inyectable, cero
 * dependencias). Proveedor externo: sujeto a la sensitivity policy en el
 * nivel `public` como el resto de proveedores públicos.
 *
 * @param {string} prompt
 * @param {AnthropicOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runAnthropic(prompt, options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = options.model ?? 'claude-opus-4-8';
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const maxTokens = options.maxTokens ?? 1024;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!apiKey) {
    throw new Error('Anthropic: falta apiKey (vía opts o env ANTHROPIC_API_KEY).');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Anthropic: fetch no disponible.');
  }

  const response = await fetchImpl(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const stdout = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      provider: 'anthropic',
      process: {
        stdout,
        stderr: `HTTP ${response.status} ${response.statusText}`,
        exitCode: 1,
        signal: null,
        timedOut: false,
      },
      parsedOutput: { format: 'text', json: null, text: stdout },
      providerMeta: { model, anthropicVersion: ANTHROPIC_VERSION },
    };
  }
  /** @type {any} */
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = null;
  }
  // La respuesta trae content como array de bloques; concatenamos los de
  // tipo text. stop_reason viaja en providerMeta — un "refusal" (Claude
  // Fable 5) o "max_tokens" es decisión del caller, no fallback nuestro.
  const content = Array.isArray(json?.content)
    ? json.content
        .filter((/** @type {any} */ block) => block?.type === 'text')
        .map((/** @type {any} */ block) => block.text)
        .join('')
    : stdout;
  return {
    provider: 'anthropic',
    process: { stdout, stderr: '', exitCode: 0, signal: null, timedOut: false },
    parsedOutput: {
      format: 'json',
      json: { answer: content, raw: json },
      text: content,
    },
    providerMeta: {
      model: json?.model ?? model,
      anthropicVersion: ANTHROPIC_VERSION,
      stopReason: json?.stop_reason ?? null,
      usage: json?.usage ?? null,
    },
  };
}
