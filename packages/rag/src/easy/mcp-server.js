// @ts-check
/**
 * Capa Easy RAG — servidor MCP del índice (ADR-005 §7).
 *
 * Implementación minimalista del transporte stdio de MCP (JSON-RPC 2.0
 * delimitado por saltos de línea) sin dependencias: initialize,
 * tools/list y tools/call con dos tools — `rag_query` y `rag_status`.
 * Es el subset que consumen los clientes MCP estándar (Claude Code,
 * etc.); capacidades adicionales se ampliarán cuando un cliente las exija.
 */
import { createInterface } from 'node:readline';

/**
 * @typedef {import('./rag-service.js').RagService} RagService
 * @typedef {{ jsonrpc: '2.0', id?: number | string | null, method?: string, params?: Record<string, any> }} JsonRpcMessage
 */

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = Object.freeze({ name: 'karajan-rag', version: '0.2.0' });

const TOOLS = Object.freeze([
  {
    name: 'rag_query',
    description:
      'Busca en el índice RAG (retrieval híbrido vector+BM25) y devuelve los pasajes más relevantes con fuente, línea y score.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Pregunta o términos de búsqueda.' },
        topK: { type: 'integer', minimum: 1, maximum: 100, description: 'Nº de pasajes (default 5).' },
      },
      required: ['question'],
    },
  },
  {
    name: 'rag_status',
    description: 'Estado del índice: fingerprint, nº de ficheros, nº de chunks y store.',
    inputSchema: { type: 'object', properties: {} },
  },
]);

/**
 * @param {number | string | null} id
 * @param {unknown} result
 */
function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * @param {number | string | null} id
 * @param {number} code
 * @param {string} message
 */
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Ejecuta una tool y devuelve el resultado en formato MCP.
 *
 * @param {RagService} service
 * @param {string} name
 * @param {Record<string, any>} args
 */
async function callTool(service, name, args) {
  if (name === 'rag_query') {
    const question = typeof args.question === 'string' ? args.question : '';
    const topK = args.topK ?? 5;
    const result = await service.query(question, topK);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
  if (name === 'rag_status') {
    const status = await service.status();
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
  throw new Error(`tool desconocida: "${name}" (disponibles: rag_query, rag_status).`);
}

/**
 * Procesa un mensaje JSON-RPC de MCP. Devuelve la respuesta, o null si
 * el mensaje es una notificación (sin id) que no requiere respuesta.
 *
 * @param {RagService} service
 * @param {JsonRpcMessage} message
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function handleMcpMessage(service, message) {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;

  switch (message.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: message.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return isNotification ? null : rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(message.params?.name ?? '');
      const args = message.params?.arguments ?? {};
      try {
        return rpcResult(id, await callTool(service, name, args));
      } catch (err) {
        // Errores de ejecución de tool van como resultado isError (spec MCP),
        // no como error JSON-RPC — el cliente los muestra al modelo.
        return rpcResult(id, {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
    }
    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `método no soportado: "${message.method}".`);
  }
}

/**
 * Arranca el servidor MCP sobre stdio (o streams inyectados en tests).
 * Cada línea de entrada es un mensaje JSON-RPC; cada respuesta se emite
 * como una línea JSON. Líneas malformadas → error -32700 sin matar el
 * proceso.
 *
 * @param {RagService} service
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [io]
 * @returns {{ close: () => void }}
 */
export function startRagMcpServer(service, io = {}) {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const rl = createInterface({ input });

  rl.on('line', async (line) => {
    if (line.trim() === '') return;
    /** @type {JsonRpcMessage} */
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(rpcError(null, -32700, 'JSON inválido.'))}\n`);
      return;
    }
    const response = await handleMcpMessage(service, message);
    if (response !== null) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  });

  return { close: () => rl.close() };
}
