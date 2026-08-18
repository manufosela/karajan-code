// @ts-check
/**
 * Historial de informes (KJW-TSK-0024).
 *
 * El comentario de una PR es efímero: cuando alguien pregunta «¿esto va a
 * mejor o a peor?» no hay nada que mirar. Aquí se guarda cada informe con
 * su evidencia, para poder responder — y para alimentar un dashboard el día
 * que lo haya (KJW-TSK-0034).
 *
 * Dos decisiones deliberadas:
 *
 * - **Opt-in.** Sin la sección `history` en el config no se escribe nada, ni
 *   siquiera se crea el directorio. Guardar informes es una decisión de cada
 *   organización, no un efecto colateral de analizar un merge.
 * - **A fichero por defecto.** Montar una instancia no exige base de datos
 *   (KJW-TSK-0032) y el historial no debería ser el motivo de montar una.
 *   NDJSON en un directorio: una línea por run, se lee con cualquier cosa.
 */
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactPII } from 'karajan-rag';

/** Directorio por defecto del historial, relativo al workspace. */
export const DEFAULT_HISTORY_DIR = '.kjw-history';

/** Fichero NDJSON donde se acumulan los informes. */
export const HISTORY_FILE = 'reports.ndjson';

/** Error de escritura o lectura del historial. */
export class HistoryError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'HistoryError';
  }
}

/**
 * @typedef {Object} HistoryRecord
 * @property {string} at Instante ISO en que se produjo el informe.
 * @property {'impact' | 'drift'} kind
 * @property {string} repo Repo origen del merge analizado.
 * @property {string} diffSummary
 * @property {{store: string, embedder: string}} measuredWith Los scores no son comparables entre backends: sin esto el histórico mezcla peras y manzanas.
 * @property {unknown[]} entries Ranking o secciones, con su evidencia.
 */

/**
 * Aplica redactPII a los textos de una estructura, dejando intactos números
 * y booleanos.
 *
 * Redactar el JSON ya serializado —que es lo natural— lo CORROMPE: un score
 * como `0.15476923` tiene una tirada de dígitos que el detector lee como
 * número de tarjeta, y `"score":0.[REDACTED_CARD]` ya no es JSON válido. Lo
 * descubrió el smoke, no los tests: los dobles usaban scores cortos.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
const redactStrings = (value) => {
  if (typeof value === 'string') return redactPII(value).text;
  if (Array.isArray(value)) return value.map(redactStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, redactStrings(inner)]),
    );
  }
  return value;
};

/**
 * Ruta del fichero de historial para un workspace.
 *
 * @param {import('./config.js').WatchConfig} config
 * @param {string} workspaceDir
 * @returns {string}
 */
const historyPath = (config, workspaceDir) =>
  join(workspaceDir, config.history?.dir ?? DEFAULT_HISTORY_DIR, HISTORY_FILE);

/**
 * Guarda un informe. No-op explícito si el historial no está activado.
 *
 * @param {Object} params
 * @param {import('./config.js').WatchConfig} params.config
 * @param {Omit<HistoryRecord, 'at'>} params.report
 * @param {string} params.workspaceDir
 * @param {() => Date} [params.now] Inyectable para poder fijar el instante en los tests.
 * @returns {Promise<{persisted: boolean, path?: string}>}
 */
export const appendReport = async ({ config, report, workspaceDir, now = () => new Date() }) => {
  if (!config.history?.enabled) return { persisted: false };

  const path = historyPath(config, workspaceDir);
  /** @type {HistoryRecord} */
  const record = { at: now().toISOString(), ...report };
  // Un histórico es tan público como el fichero que lo contiene: pasa por el
  // mismo redactPII que el informe, no por uno más laxo — pero campo a campo,
  // para no romper el JSON.
  const line = JSON.stringify(redactStrings(record));

  try {
    await mkdir(join(workspaceDir, config.history.dir ?? DEFAULT_HISTORY_DIR), {
      recursive: true,
    });
    await appendFile(path, `${line}\n`, 'utf8');
  } catch (err) {
    throw new HistoryError(`no se pudo escribir el historial en "${path}".`, { cause: err });
  }
  return { persisted: true, path };
};

/**
 * Lee el historial, descartando lo que haya caducado según `retentionDays`.
 * Sin retención declarada no se descarta nada: perder histórico jamás debe
 * ser un default.
 *
 * @param {Object} params
 * @param {import('./config.js').WatchConfig} params.config
 * @param {string} params.workspaceDir
 * @param {() => Date} [params.now]
 * @returns {Promise<HistoryRecord[]>}
 */
export const readHistory = async ({ config, workspaceDir, now = () => new Date() }) => {
  const path = historyPath(config, workspaceDir);
  /** @type {string} */
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (/** @type {{code?: string}} */ (err).code === 'ENOENT') return [];
    throw new HistoryError(`no se pudo leer el historial en "${path}".`, { cause: err });
  }

  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  /** @type {HistoryRecord[]} */
  const records = lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      // Saltarse la línea daría un histórico incompleto sin que nadie se
      // entere, que es peor que no tenerlo.
      throw new HistoryError(
        `línea ${i + 1} del historial ilegible en "${path}": no es JSON válido.`,
        { cause: err },
      );
    }
  });

  const retentionDays = config.history?.retentionDays;
  if (retentionDays === undefined) return records;

  const cutoff = now().getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return records.filter((record) => Date.parse(record.at) >= cutoff);
};
