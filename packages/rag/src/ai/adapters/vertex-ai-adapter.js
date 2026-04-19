// @ts-check

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} VertexAIOptions
 * @property {string} [project] GCP project id (default env GOOGLE_CLOUD_PROJECT).
 * @property {string} [location] Region (default 'us-central1').
 * @property {string} [model] Nombre de modelo (default 'gemini-1.5-flash').
 * @property {number} [maxTokens] Default 1024.
 * @property {any} [sdk] Módulo @google-cloud/vertexai inyectable (tests).
 */

/**
 * Adapter Google Vertex AI vía SDK oficial. Credenciales: via
 * GOOGLE_APPLICATION_CREDENTIALS o ADC. @google-cloud/vertexai es
 * peer-dependency opcional.
 *
 * @param {string} prompt
 * @param {VertexAIOptions} [options]
 * @returns {Promise<AdapterResult>}
 */
export async function runVertexAi(prompt, options = {}) {
  const project = options.project ?? process.env.GOOGLE_CLOUD_PROJECT;
  const location = options.location ?? 'us-central1';
  const model = options.model ?? 'gemini-1.5-flash';
  const maxTokens = options.maxTokens ?? 1024;
  if (!project) {
    throw new Error(
      'VertexAI: falta "project" (vía opts o env GOOGLE_CLOUD_PROJECT).',
    );
  }
  const sdk = options.sdk ?? (await loadVertexSdk());
  const { VertexAI } = sdk;
  const vertexAI = new VertexAI({ project, location });
  const generativeModel = vertexAI.getGenerativeModel({ model });

  const request = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  const response = await generativeModel.generateContent(request);
  const raw = response?.response ?? response;
  const candidates = raw?.candidates ?? [];
  const text = candidates[0]?.content?.parts?.[0]?.text ?? '';

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

async function loadVertexSdk() {
  try {
    return await import('@google-cloud/vertexai');
  } catch (err) {
    throw new Error(
      "VertexAI adapter requiere '@google-cloud/vertexai'. Instala con: pnpm add @google-cloud/vertexai",
      { cause: err },
    );
  }
}
