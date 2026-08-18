// @ts-check
import { readFile } from 'node:fs/promises';

/**
 * @typedef {Object} StageConfig
 * @property {string} role Nombre del rol en el RoleRegistry.
 * @property {string} [name] Nombre del stage (por defecto igual al rol).
 * @property {Record<string, unknown>} [options] Opciones pasadas al rol/stage.
 */

/**
 * @typedef {Object} PipelineConfig
 * @property {string} name
 * @property {string} [description]
 * @property {StageConfig[]} stages
 * @property {"abort" | "continue"} [errorPolicy]
 */

/**
 * Valida la forma del objeto config. Lanza con mensaje explícito si no cumple.
 *
 * @param {unknown} raw
 * @returns {PipelineConfig}
 */
export function validatePipelineConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('PipelineConfig inválido: se esperaba un objeto.');
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new Error('PipelineConfig inválido: "name" requerido (string no vacío).');
  }
  if (!Array.isArray(obj.stages) || obj.stages.length === 0) {
    throw new Error('PipelineConfig inválido: "stages" debe ser array no vacío.');
  }
  const stages = obj.stages.map((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new Error(`PipelineConfig: stage[${i}] no es objeto.`);
    }
    const stage = /** @type {Record<string, unknown>} */ (s);
    if (typeof stage.role !== 'string' || stage.role.length === 0) {
      throw new Error(`PipelineConfig: stage[${i}].role requerido (string no vacío).`);
    }
    return {
      role: stage.role,
      name: typeof stage.name === 'string' ? stage.name : stage.role,
      options:
        stage.options && typeof stage.options === 'object'
          ? /** @type {Record<string, unknown>} */ (stage.options)
          : {},
    };
  });
  const errorPolicy =
    obj.errorPolicy === 'abort' || obj.errorPolicy === 'continue' ? obj.errorPolicy : undefined;
  return {
    name: obj.name,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    stages,
    errorPolicy,
  };
}

/**
 * Carga y valida un PipelineConfig desde un fichero JSON.
 *
 * @param {string} filePath
 * @returns {Promise<PipelineConfig>}
 */
export async function loadPipelineConfig(filePath) {
  const raw = await readFile(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `loadPipelineConfig: JSON inválido en "${filePath}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
  return validatePipelineConfig(parsed);
}
