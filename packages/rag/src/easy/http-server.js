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
 * Crea el servidor HTTP (sin arrancarlo — el caller hace listen/close).
 *
 * @param {RagService} service
 * @returns {import('node:http').Server}
 */
export function createRagHttpServer(service) {
  return createServer(async (req, res) => {
    try {
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
 * @param {{ port?: number, host?: string }} [options]
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
export async function startRagHttpServer(service, options = {}) {
  const server = createRagHttpServer(service);
  const port = options.port ?? 8080;
  const host = options.host ?? '0.0.0.0';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { server, url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}` };
}
