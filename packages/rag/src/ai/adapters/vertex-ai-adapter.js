// @ts-check

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} VertexAIOptions
 * @property {string} [project] GCP project id (default env GOOGLE_CLOUD_PROJECT).
 * @property {string} [location] Region (default env VERTEX_LOCATION, después 'us-central1').
 * @property {string} [model] Nombre de modelo (default env VERTEX_MODEL, después 'gemini-2.5-flash').
 * @property {number} [maxTokens] Default 8192.
 * @property {any} [sdk] Módulo @google/genai inyectable (tests).
 */

/**
 * Adapter Google Vertex AI vía el Google Gen AI SDK (@google/genai en modo
 * vertexai — KJR-TSK-0159: el SDK anterior, @google-cloud/vertexai, quedó
 * deprecado con retirada anunciada para jun-2026). Credenciales: via
 * GOOGLE_APPLICATION_CREDENTIALS o ADC. @google/genai es peer opcional.
 *
 * @param {string} prompt
 * @param {VertexAIOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runVertexAi(prompt, options = {}) {
  const project = options.project ?? process.env.GOOGLE_CLOUD_PROJECT;
  // options > entorno > default — la instancia fija región y modelo sin
  // tocar código (KJW-BUG-0011: una instancia europea no debe sacar datos
  // de la UE por un default).
  const location = options.location ?? process.env.VERTEX_LOCATION ?? 'us-central1';
  // gemini-1.5/2.0-flash están retirados (404 verificado en campo); los
  // modelos 2.5 gastan tokens de razonamiento que cuentan como salida,
  // así que 1024 dejaba la respuesta VACÍA (KJR-BUG-0011, issue #155).
  const model = options.model ?? process.env.VERTEX_MODEL ?? 'gemini-2.5-flash';
  const maxTokens = options.maxTokens ?? 8192;
  if (!project) {
    throw new Error(
      'VertexAI: falta "project" (vía opts o env GOOGLE_CLOUD_PROJECT).',
    );
  }
  const sdk = options.sdk ?? (await loadGenAiSdk());
  const { GoogleGenAI } = sdk;
  const ai = new GoogleGenAI({ vertexai: true, project, location });

  const request = {
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { maxOutputTokens: maxTokens },
  };
  const raw = await ai.models.generateContent(request);
  const candidates = raw?.candidates ?? [];
  const text = candidates[0]?.content?.parts?.[0]?.text ?? '';
  // Respuesta vacía por presupuesto agotado: decirlo, no devolver un JSON
  // vacío que hace culpar al parseo ("no devolvió ningún objeto JSON").
  if (text === '' && candidates[0]?.finishReason === 'MAX_TOKENS') {
    throw new Error(
      `VertexAI: respuesta vacía con finishReason MAX_TOKENS — el modelo "${model}" agotó ` +
        `maxTokens (${maxTokens}) pensando antes de emitir salida. Sube "maxTokens" en las opciones.`,
    );
  }

  return {
    provider: 'vertex-ai',
    process: {
      stdout: JSON.stringify(raw),
      stderr: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
    },
    parsedOutput: {
      format: 'json',
      json: { answer: text, raw },
      text,
    },
    providerMeta: {
      project,
      location,
      model,
      usage: raw?.usageMetadata ?? null,
    },
  };
}

async function loadGenAiSdk() {
  try {
    return await import('@google/genai');
  } catch (err) {
    throw new Error(
      "VertexAI adapter requiere '@google/genai'. Instala con: pnpm add @google/genai",
      { cause: err },
    );
  }
}
