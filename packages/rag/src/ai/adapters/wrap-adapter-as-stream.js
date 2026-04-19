// @ts-check
/**
 * Convierte un AdapterFunction normal (p. ej. `runClaudeCli`, `runAzureOpenAi`)
 * en un StreamAdapterFunction: invoca el adapter una vez, extrae la respuesta
 * y la emite en trozos de `chunkSize` caracteres con un delay opcional.
 *
 * No hay streaming real — el adapter subyacente sigue siendo blocking. Esta
 * función sirve para:
 *   - Homogeneizar el código cliente: puedes pasar un `StreamAdapterFunction`
 *     a `GeneratorRole.streamGenerate()` venga o no el proveedor con streaming.
 *   - Simular una UX progresiva en demos sin conectar a un LLM streaming real.
 *
 * Si quieres streaming real, usa `createOllamaStreamAdapter` (o adapters
 * streaming equivalentes cuando existan).
 *
 * @typedef {import('../adapter-registry.js').AdapterFunction} AdapterFunction
 * @typedef {(prompt: string) => AsyncIterable<string>} StreamAdapterFunction
 */

/**
 * @param {AdapterFunction} adapter
 * @param {{ chunkSize?: number, delayMs?: number }} [options]
 * @returns {(prompt: string) => AsyncGenerator<string, void, void>}
 */
export function wrapAdapterAsStream(adapter, options = {}) {
  if (typeof adapter !== 'function') {
    throw new Error('wrapAdapterAsStream: adapter debe ser una función.');
  }
  const chunkSize = Math.max(1, options.chunkSize ?? 32);
  const delayMs = Math.max(0, options.delayMs ?? 0);

  return async function* wrapped(prompt) {
    const result = await adapter(prompt);
    const text = extractText(result);
    if (text.length === 0) return;

    for (let i = 0; i < text.length; i += chunkSize) {
      if (delayMs > 0 && i > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      yield text.slice(i, i + chunkSize);
    }
  };
}

/**
 * Extrae el texto "principal" de un AdapterResult. Soporta el formato JSON
 * estricto (campo `answer`) y el plano (campo `text`).
 *
 * @param {unknown} result
 * @returns {string}
 */
function extractText(result) {
  if (!result || typeof result !== 'object') return '';
  const parsed = /** @type {any} */ (result).parsedOutput;
  if (!parsed) return '';
  if (parsed.format === 'json' && parsed.json && typeof parsed.json === 'object') {
    const obj = /** @type {any} */ (parsed.json);
    if (typeof obj.answer === 'string') return obj.answer;
  }
  return typeof parsed.text === 'string' ? parsed.text : '';
}
