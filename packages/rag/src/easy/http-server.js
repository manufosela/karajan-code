// @ts-check
/**
 * Capa Easy RAG — servidor HTTP del índice (ADR-005 §7).
 *
 * API mínima sin dependencias (node:http):
 *   POST /query  {question, topK?}  → { hits, candidates }
 *   GET  /health                    → { ok, ...status del índice }
 *
 * Validación estricta de entrada y errores JSON explícitos. La
 * autenticación llega con el despliegue cloud (fuera de alcance aquí).
 */
import { createServer } from 'node:http';
import { PLAYGROUND_HTML } from './playground-page.js';

/**
 * @typedef {import('./rag-service.js').RagService} RagService
 */

/** Límite del body de /query: una pregunta, no un documento. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {unknown} payload
 */
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Lee y parsea el body JSON con límite de tamaño.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error('body demasiado grande (máx 64KB).'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(raw === '' ? '{}' : raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('no es un objeto');
    }
    return parsed;
  } catch {
    throw Object.assign(new Error('body JSON inválido (esperado: {"question": "..."}).'), {
      statusCode: 400,
    });
  }
}

/**
 * Valida el payload de /query.
 *
 * @param {Record<string, unknown>} body
 * @returns {{ question: string, topK: number }}
 */
function validateQueryPayload(body) {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question.length === 0) {
    throw Object.assign(new Error('"question" es obligatorio (string no vacío).'), {
      statusCode: 400,
    });
  }
  const topK = body.topK === undefined ? 5 : body.topK;
  if (!Number.isInteger(topK) || /** @type {number} */ (topK) <= 0 || /** @type {number} */ (topK) > 100) {
    throw Object.assign(new Error('"topK" debe ser un entero en [1, 100].'), { statusCode: 400 });
  }
  return { question, topK: /** @type {number} */ (topK) };
}

/**
 * Valida el payload de /answer.
 *
 * @param {Record<string, unknown>} body
 * @returns {{ question: string, options: import('./answer.js').AnswerWithModeOptions }}
 */
function validateAnswerPayload(body) {
  const { question, topK } = validateQueryPayload(body);
  const mode = body.mode === undefined ? 'rag' : body.mode;
  if (mode !== 'rag' && mode !== 'cag' && mode !== 'hybrid') {
    throw Object.assign(new Error('"mode" debe ser rag, cag o hybrid.'), { statusCode: 400 });
  }
  if (body.adapter !== undefined && (typeof body.adapter !== 'string' || body.adapter.length === 0)) {
    throw Object.assign(new Error('"adapter" debe ser un string no vacío.'), { statusCode: 400 });
  }
  const maxContextChars = body.maxContextChars;
  const MAX_CONTEXT_CAP = 5_000_000;
  if (
    maxContextChars !== undefined &&
    (!Number.isInteger(maxContextChars) ||
      /** @type {number} */ (maxContextChars) <= 0 ||
      /** @type {number} */ (maxContextChars) > MAX_CONTEXT_CAP)
  ) {
    throw Object.assign(
      new Error(`"maxContextChars" debe ser un entero en [1, ${MAX_CONTEXT_CAP}].`),
      { statusCode: 400 },
    );
  }
  return {
    question,
    options: {
      mode,
      // topK solo si el cliente lo manda: sin él mandan los defaults del
      // corpus (karajan.config.json), igual que en el CLI.
      ...(body.topK !== undefined ? { topK } : {}),
      ...(body.adapter !== undefined
        ? { adapter: /** @type {string} */ (body.adapter), adapterExplicit: true }
        : {}),
      ...(maxContextChars !== undefined ? { maxContextChars: /** @type {number} */ (maxContextChars) } : {}),
    },
  };
}

/**
 * Crea el servidor HTTP (sin arrancarlo — el caller hace listen/close).
 *
 * @param {RagService} service
 * @param {{ adapterRegistry?: { get: (name: string) => unknown, has: (name: string) => boolean }, ui?: boolean }} [options]
 * @returns {import('node:http').Server}
 */
export function createRagHttpServer(service, options = {}) {
  const ui = options.ui !== false;
  return createServer(async (req, res) => {
    try {
      if (ui && req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(PLAYGROUND_HTML),
        });
        res.end(PLAYGROUND_HTML);
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        const status = await service.status();
        sendJson(res, 200, { ok: true, ...status });
        return;
      }
      if (req.method === 'POST' && req.url === '/query') {
        const body = await readJsonBody(req);
        const { question, topK } = validateQueryPayload(body);
        const result = await service.query(question, topK);
        sendJson(res, 200, result);
        return;
      }
      if (req.method === 'POST' && req.url === '/answer') {
        const body = await readJsonBody(req);
        const { question, options: answerOptions } = validateAnswerPayload(body);
        try {
          const result = await service.answer(question, {
            ...answerOptions,
            registry: options.adapterRegistry,
            log: () => {},
          });
          // Por red NO viaja el inventario del corpus (listas de rutas de
          // files/excluded): solo conteos. Las garantías (adapter, nivel,
          // modo) sí son siempre visibles.
          const { files, excluded, ...rest } = result;
          sendJson(res, 200, {
            ...rest,
            ...(files ? { filesCount: files.length } : {}),
            ...(excluded ? { excludedCount: excluded.length } : {}),
          });
        } catch (err) {
          // Rechazo del gate de sensibilidad = 403 (petición prohibida
          // por policy), no un error del servidor.
          if (err instanceof Error && err.message.includes('no está permitido')) {
            throw Object.assign(err, { statusCode: 403 });
          }
          throw err;
        }
        return;
      }
      sendJson(res, 404, { error: `ruta no soportada: ${req.method} ${req.url}` });
    } catch (err) {
      const statusCode =
        typeof (/** @type {{ statusCode?: unknown }} */ (err)?.statusCode) === 'number'
          ? /** @type {{ statusCode: number }} */ (err).statusCode
          : 500;
      sendJson(res, statusCode, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/**
 * Arranca el servidor y resuelve con la URL local efectiva.
 *
 * @param {RagService} service
 * @param {{ port?: number, host?: string, adapterRegistry?: { get: (name: string) => unknown, has: (name: string) => boolean }, ui?: boolean }} [options]
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
export async function startRagHttpServer(service, options = {}) {
  const server = createRagHttpServer(service, {
    adapterRegistry: options.adapterRegistry,
    ui: options.ui,
  });
  const port = options.port ?? 8080;
  const host = options.host ?? '0.0.0.0';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { server, url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}` };
}
