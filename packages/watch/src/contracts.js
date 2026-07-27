// @ts-check
/**
 * F2 — señal 4: contratos consumer-driven por minería sobre el corpus.
 *
 * Las otras tres señales son heurísticas: similitud semántica, correlación
 * temporal y opinión de un LLM. Esta busca **acoplamiento declarado**: si el
 * diff toca la ruta `/api/v1/users/:id` y otro repo contiene esa misma
 * cadena, no es que se parezcan — es que uno consume al otro.
 *
 * Dos fases:
 *   1. `extractContractTokens` saca del diff los identificadores de contrato
 *      (rutas HTTP, topics de evento, tablas SQL). Las líneas **quitadas**
 *      importan tanto o más que las añadidas: un endpoint renombrado o
 *      borrado es exactamente lo que rompe a su consumidor.
 *   2. `findContractMatches` consulta el corpus con cada identificador y se
 *      queda solo con los hits de OTROS repos cuyo contenido lo contiene
 *      **literalmente**. Esa verificación literal es lo que convierte la
 *      señal en evidencia citable en vez de en otra similitud.
 */

/** Tipos de contrato minados en la v1. */
export const CONTRACT_TYPES = Object.freeze(['http', 'event', 'sql']);

/** Longitud mínima de un identificador para no inundar de ruido. */
const MIN_TOKEN_LENGTH = 4;

/** Identificadores tan comunes que jamás son evidencia de acoplamiento. */
const GENERIC_TOKENS = new Set([
  'data', 'value', 'test', 'tests', 'item', 'items', 'list', 'name', 'type',
  'index', 'result', 'error', 'true', 'false', 'null', 'user', 'users',
]);

const HTTP_ROUTE_PATTERNS = [
  // app.get('/x'), router.post("/x"), fetch('/x'), axios.put(`/x`)
  /(?:get|post|put|patch|delete|options|head|fetch|request)\s*\(\s*['"`](\/[^'"`\s]*)['"`]/gi,
  // Decoradores: @Get('/x'), @RequestMapping("/x")
  /@\w+\s*\(\s*['"`](\/[^'"`\s]*)['"`]/g,
];
// Path de OpenAPI: dos espacios de indentación y dos puntos finales.
const OPENAPI_PATH = /^\s{2,}(\/[\w{}:./-]*)\s*:\s*$/;

const EVENT_PATTERNS = [
  // publish('x'), emit("x"), subscribe(`x`), consume('x'), on('x')
  /(?:publish|emit|subscribe|consume|dispatch|send|on)\s*\(\s*['"`]([\w.:-]+)['"`]/gi,
];

const SQL_PATTERNS = [
  /\b(?:create|alter|drop|truncate)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?["'`]?([\w.]+)["'`]?/gi,
  /\bfrom\s+["'`]?([a-z_][\w.]*)["'`]?/gi,
  /\bjoin\s+["'`]?([a-z_][\w.]*)["'`]?/gi,
  /\binsert\s+into\s+["'`]?([a-z_][\w.]*)["'`]?/gi,
];

/**
 * @typedef {import('./diff.js').DiffChunk} DiffChunk
 *
 * @typedef {Object} ContractToken
 * @property {string} value Identificador tal y como aparece en el código.
 * @property {'http' | 'event' | 'sql'} type
 * @property {boolean} removed true si venía de una línea eliminada del diff.
 * @property {{path: string, newStart: number}} fromChunk
 *
 * @typedef {Object} ContractMatch
 * @property {string} source Fichero de otro repo que usa el identificador.
 * @property {string} repo
 * @property {number | null} line
 * @property {ContractToken[]} tokens Identificadores hallados literalmente en él.
 *
 * @typedef {Object} ContractResult
 * @property {ContractMatch[]} matches
 * @property {number} tokensSearched
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
const isMeaningful = (value) => {
  const bare = value.replace(/^\//, '');
  if (bare.length < MIN_TOKEN_LENGTH) return false;
  if (GENERIC_TOKENS.has(bare.toLowerCase())) return false;
  // Un evento o tabla debe tener alguna estructura: separador o mayúsculas.
  return true;
};

/**
 * @param {string} line
 * @param {'http' | 'event' | 'sql'} type
 * @returns {string[]}
 */
const matchLine = (line, type) => {
  /** @type {string[]} */
  const found = [];
  if (type === 'http') {
    for (const pattern of HTTP_ROUTE_PATTERNS) {
      for (const m of line.matchAll(pattern)) found.push(m[1]);
    }
    const openapi = OPENAPI_PATH.exec(line);
    if (openapi) found.push(openapi[1]);
  } else if (type === 'event') {
    for (const pattern of EVENT_PATTERNS) {
      for (const m of line.matchAll(pattern)) found.push(m[1]);
    }
  } else {
    for (const pattern of SQL_PATTERNS) {
      for (const m of line.matchAll(pattern)) found.push(m[1]);
    }
  }
  return found.filter(isMeaningful);
};

/**
 * Extrae los identificadores de contrato del diff, de líneas añadidas y
 * quitadas. El mismo identificador no se repite para un mismo chunk.
 *
 * @param {DiffChunk[]} chunks
 * @param {{types?: readonly string[]}} [options]
 * @returns {ContractToken[]}
 */
export const extractContractTokens = (chunks, options = {}) => {
  const types = options.types ?? CONTRACT_TYPES;
  /** @type {Map<string, ContractToken>} */
  const byKey = new Map();

  /** @type {Map<string, {added: boolean, removed: boolean}>} */
  const presence = new Map();

  for (const chunk of chunks) {
    const lines = [
      ...chunk.addedLines.map((l) => ({ text: l.content, removed: false })),
      ...chunk.removedLines.map((l) => ({ text: l.content, removed: true })),
    ];
    for (const { text, removed } of lines) {
      for (const type of CONTRACT_TYPES) {
        if (!types.includes(type)) continue;
        for (const value of matchLine(text, /** @type {never} */ (type))) {
          const key = `${type}:${value}:${chunk.path}`;
          const seen = presence.get(key) ?? { added: false, removed: false };
          presence.set(key, {
            added: seen.added || !removed,
            removed: seen.removed || removed,
          });
          if (!byKey.has(key)) {
            byKey.set(key, {
              value,
              type: /** @type {never} */ (type),
              removed,
              fromChunk: { path: chunk.path, newStart: chunk.newStart },
            });
          }
        }
      }
    }
  }

  // `removed` marca ROTURA, no "apareció en una línea quitada": un
  // identificador presente además en las añadidas sigue vigente (se movió
  // de sitio dentro del hunk) y marcarlo roto sería un falso positivo.
  return [...byKey.entries()].map(([key, token]) => {
    const seen = presence.get(key);
    return { ...token, removed: Boolean(seen?.removed && !seen.added) };
  });
};

/**
 * Busca cada identificador en el corpus y conserva solo los ficheros de
 * otros repos que lo contienen literalmente.
 *
 * @param {Object} params
 * @param {ContractToken[]} params.tokens
 * @param {import('./retrieval.js').QueryFn} params.query
 * @param {string} params.excludeRepo Repo origen del diff.
 * @param {number} [params.topK] Hits a pedir por identificador (default 8).
 * @returns {Promise<ContractResult>}
 */
export const findContractMatches = async ({ tokens, query, excludeRepo, topK = 8 }) => {
  if (tokens.length === 0) return { matches: [], tokensSearched: 0 };
  const originPrefix = `${excludeRepo}/`;
  /** @type {Map<string, ContractMatch>} */
  const bySource = new Map();

  for (const token of tokens) {
    const response = await query(token.value, { topK });
    for (const hit of response.hits) {
      if (hit.source.startsWith(originPrefix)) continue;
      // La verificación literal es la que convierte esto en evidencia: sin
      // ella solo tendríamos otra vez similitud semántica.
      if (!String(hit.content ?? '').includes(token.value)) continue;
      const existing = bySource.get(hit.source);
      if (existing) {
        if (!existing.tokens.some((t) => t.value === token.value && t.type === token.type)) {
          existing.tokens.push(token);
        }
      } else {
        bySource.set(hit.source, {
          source: hit.source,
          repo: hit.source.split('/')[0],
          line: hit.line ?? null,
          tokens: [token],
        });
      }
    }
  }

  return { matches: [...bySource.values()], tokensSearched: tokens.length };
};
