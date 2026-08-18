// @ts-check
/**
 * Helper de deprecación (docs/DEPRECATION.md, criterio 1.0).
 *
 * Emite el aviso estándar de Node (`DeprecationWarning`) UNA sola vez por
 * símbolo y proceso — nunca spam — y respeta los flags estándar
 * (`--no-deprecation`, `--trace-deprecation`).
 */

/** @type {Set<string>} */
const warned = new Set();

/**
 * Marca un uso deprecado. Llamadas repetidas con el mismo `name` no
 * vuelven a avisar.
 *
 * @param {string} name Símbolo deprecado (ej. "runFoo").
 * @param {{ since: string, removal: string, alternative?: string }} info
 *   Versión que depreca, versión prevista de eliminación y alternativa.
 * @returns {boolean} true si el aviso se emitió (primera vez), false si ya estaba avisado.
 */
export function deprecate(name, info) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('deprecate: "name" requerido (string no vacío).');
  }
  if (!info || typeof info.since !== 'string' || typeof info.removal !== 'string') {
    throw new Error('deprecate: "since" y "removal" requeridos (docs/DEPRECATION.md).');
  }
  if (warned.has(name)) return false;
  warned.add(name);
  const alternative = info.alternative ? ` Usa ${info.alternative} en su lugar.` : '';
  process.emitWarning(
    `${name} está deprecado desde la ${info.since} y se eliminará en la ${info.removal}.${alternative}`,
    { type: 'DeprecationWarning', code: `KJR_DEPRECATED_${name}` },
  );
  return true;
}

/**
 * Solo para tests: olvida los avisos ya emitidos.
 */
export function resetDeprecationWarnings() {
  warned.clear();
}
