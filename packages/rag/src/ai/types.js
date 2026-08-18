// @ts-check
/**
 * Tipos compartidos por todos los adapters de CLIs de IA.
 *
 * Solo contiene @typedef. Los adapters los importan con JSDoc:
 *   @typedef {import('../types.js').AdapterResult} AdapterResult
 *
 * KJR-TSK-0005 · Parte de la épica CLI Adapter Layer (KJR-PCS-0003).
 */

/**
 * @typedef {"codex" | "claude" | "gemini" | "ollama" | string} ProviderName
 *   Identificador textual del proveedor. Los tres iniciales son fijos;
 *   nuevos adapters (ollama, azure-openai, bedrock…) se añaden extendiendo
 *   la union en tiempo de uso sin necesidad de editar este typedef.
 */

/**
 * Metadata específica del proveedor, opcional. Cada adapter define su propia
 * forma (p. ej. Codex devuelve `{ threadId, usage, events }`). Se deja
 * deliberadamente como `Record<string, unknown>` para no acoplar los types
 * compartidos a las peculiaridades de cada CLI.
 *
 * @typedef {Record<string, unknown>} ProviderMeta
 */

/**
 * Resultado del proceso spawneado por el runner. Viene de cli-runner.js.
 *
 * @typedef {import('./cli-runner.js').CliRunResult} CliRunResult
 */

/**
 * Salida normalizada por output-parser.js.
 *
 * @typedef {import('./output-parser.js').ParsedOutput} ParsedOutput
 */

/**
 * Forma común que DEBEN devolver todos los adapters de KJR.
 *
 * @typedef {Object} AdapterResult
 * @property {ProviderName} provider Identificador del proveedor.
 * @property {CliRunResult} process Resultado crudo del proceso (stdout/stderr/exitCode/…).
 * @property {ParsedOutput} parsedOutput Salida tras normalizar (JSON/texto/vacío).
 * @property {ProviderMeta} [providerMeta] Metadata específica del proveedor (opcional).
 */
