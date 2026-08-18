// @ts-check
/**
 * Modelos de datos del pipeline RAG: Document y Chunk, con metadata de
 * sensibilidad tipada para que el routing futuro (policy engine,
 * KJR-PCS-0011) pueda enrutar a adapters distintos sin refactor.
 *
 * KJR-TSK-0018 · Parte de la épica Data Sensitivity & Private Inference.
 */

/**
 * Niveles de sensibilidad soportados. Ordenados de menos a más restrictivo.
 *
 * @readonly
 */
export const SENSITIVITY_LEVELS = Object.freeze(
  /** @type {const} */ (['public', 'internal', 'confidential']),
);

/**
 * @typedef {"public" | "internal" | "confidential"} Sensitivity
 */

/**
 * Nivel por defecto cuando no hay información suficiente para decidir.
 * `internal` es la opción segura: NO se publica sin querer (a diferencia
 * de `public`) pero tampoco se bloquea la ejecución a proveedores con
 * no-training (a diferencia de `confidential`).
 */
export const DEFAULT_SENSITIVITY = 'internal';

/**
 * Metadata tipada mínima para un Document fuente.
 *
 * @typedef {Object} DocumentMetadata
 * @property {string} [source] Identificador de la fuente (URL, path, id externo…).
 * @property {string} [mimeType] "application/pdf", "text/markdown", "text/plain"…
 * @property {Sensitivity} [sensitivity] Marca explícita; si falta se usa classifySensitivity().
 * @property {string[]} [tags] Etiquetas libres (ej. "finanzas", "legal", "public-docs").
 * @property {string} [language] Código ISO del idioma (es, en, fr…).
 * @property {string} [isoDate] Fecha en ISO cuando se ingestó el documento.
 */

/**
 * Unidad completa de ingesta.
 *
 * @typedef {Object} Document
 * @property {string} id Identificador único del documento dentro del pipeline.
 * @property {string} content Texto completo del documento (post-loaders).
 * @property {DocumentMetadata} metadata Metadata tipada (incluye sensitivity si se conoce).
 */

/**
 * Fragmento derivado de un Document tras chunking. Hereda la sensibilidad
 * del documento origen por defecto.
 *
 * @typedef {Object} Chunk
 * @property {string} id Identificador único del chunk (p. ej. `${docId}#${index}`).
 * @property {string} documentId Document.id del que proviene.
 * @property {string} content Texto del fragmento.
 * @property {number} [index] Posición ordinal dentro del documento original.
 * @property {DocumentMetadata & { offset?: number, tokens?: number }} metadata
 *   Metadata del chunk: hereda la del doc + información específica del fragmento
 *   (offset en caracteres, tokens estimados…).
 */

/**
 * Devuelve la sensibilidad efectiva de un documento:
 *   1. Si `metadata.sensitivity` es válido, se respeta.
 *   2. Si falta o no es válido, se devuelve `DEFAULT_SENSITIVITY`.
 *
 * Esta función NO inspecciona el contenido heurísticamente: esa tarea queda
 * para el módulo de clasificación/redaction (épica KJR-PCS-0011). Aquí solo
 * se valida la metadata explícita.
 *
 * @param {Pick<Document, 'metadata'> | Chunk} doc
 * @returns {Sensitivity}
 */
export function classifySensitivity(doc) {
  if (!doc || !doc.metadata) return DEFAULT_SENSITIVITY;
  const declared = doc.metadata.sensitivity;
  if (declared && SENSITIVITY_LEVELS.includes(declared)) {
    return declared;
  }
  return DEFAULT_SENSITIVITY;
}

/**
 * Indica si una sensibilidad dada es permitida por un conjunto de niveles
 * aceptados. Útil para el policy engine futuro:
 *   isSensitivityAllowed('confidential', ['public', 'internal']) === false
 *
 * @param {Sensitivity} level
 * @param {readonly Sensitivity[]} allowed
 * @returns {boolean}
 */
export function isSensitivityAllowed(level, allowed) {
  return allowed.includes(level);
}

/**
 * Devuelve el nivel más restrictivo de una lista. Un valor desconocido o
 * una lista vacía degradan al DEFAULT_SENSITIVITY: ante la duda, nunca se
 * trata contenido como menos sensible de lo que podría ser.
 *
 * @param {readonly Sensitivity[]} levels
 * @returns {Sensitivity}
 */
export function maxSensitivity(levels) {
  let maxIndex = -1;
  for (const level of levels) {
    const index = SENSITIVITY_LEVELS.indexOf(level);
    if (index === -1) {
      maxIndex = Math.max(maxIndex, SENSITIVITY_LEVELS.indexOf(DEFAULT_SENSITIVITY));
      continue;
    }
    maxIndex = Math.max(maxIndex, index);
  }
  if (maxIndex === -1) return DEFAULT_SENSITIVITY;
  return SENSITIVITY_LEVELS[maxIndex];
}
