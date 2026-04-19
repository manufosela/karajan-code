// @ts-check
// Portado de karajan-code@45fd0f20a1a1b5b26bd9e8ac211145460f311a8c src/agents/index.js
// KJR-TSK-0016 · Licencia AGPL-3.0-or-later (compatible con KJR).
//
// Adaptaciones respecto al original:
// - Clase inyectable (AdapterRegistry) en lugar de Map module-level con
//   funciones exportadas `registerAgent`/`getAvailableAgents`. Cada
//   orquestador/pipeline construye su propio registry por DI.
// - Se registran "funciones adapter" (prompt → Promise<AdapterResult>)
//   en lugar de "clases Agent". KJR unifica todos los adapters bajo la
//   forma AdapterResult ya definida en src/ai/types.js.
// - Metadata por adapter (bin, installUrl, category…) sigue soportada.

/**
 * @typedef {import('./types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {(prompt: string, options?: Record<string, unknown>) => Promise<AdapterResult>} AdapterFunction
 *   Firma común de cualquier adapter de KJR. Los adapters actuales
 *   (runClaudeCli, runCodexCli, runGeminiCli) encajan en esta firma.
 */

/**
 * @typedef {Object} AdapterEntry
 * @property {AdapterFunction} fn Función adapter registrada.
 * @property {Record<string, unknown>} meta Metadata libre (bin, installUrl, tags…).
 */

/**
 * Registry de adapters inyectable por DI. Reemplaza los imports directos
 * de adapters en el orquestador y permite añadir proveedores (Ollama,
 * Azure, Bedrock…) sin tocar el orquestador ni los roles que los consumen.
 *
 * Uso típico:
 *   const registry = new AdapterRegistry();
 *   registry.register('claude', runClaudeCli, { bin: 'claude' });
 *   registry.register('codex',  runCodexCli,  { bin: 'codex' });
 *   const result = await registry.get('claude')(prompt);
 */
export class AdapterRegistry {
  constructor() {
    /** @type {Map<string, AdapterEntry>} */
    this._entries = new Map();
  }

  /**
   * Registra un adapter por nombre.
   *
   * @param {string} name
   * @param {AdapterFunction} fn
   * @param {Record<string, unknown>} [meta]
   * @returns {void}
   */
  register(name, fn, meta = {}) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('AdapterRegistry.register: "name" debe ser string no vacío.');
    }
    if (typeof fn !== 'function') {
      throw new Error(`AdapterRegistry.register("${name}"): fn debe ser una función.`);
    }
    if (this._entries.has(name)) {
      throw new Error(`AdapterRegistry.register: ya existe un adapter con nombre "${name}".`);
    }
    this._entries.set(name, { fn, meta: { ...meta } });
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._entries.has(name);
  }

  /**
   * Devuelve la función adapter registrada con ese nombre.
   *
   * @param {string} name
   * @returns {AdapterFunction}
   */
  get(name) {
    const entry = this._entries.get(name);
    if (!entry) {
      const available = [...this._entries.keys()].join(', ') || '<ninguno>';
      throw new Error(
        `AdapterRegistry.get: adapter "${name}" no registrado. Disponibles: ${available}.`,
      );
    }
    return entry.fn;
  }

  /**
   * Devuelve la metadata asociada a un adapter (copia defensiva).
   *
   * @param {string} name
   * @returns {Record<string, unknown> | null}
   */
  getMeta(name) {
    const entry = this._entries.get(name);
    return entry ? { ...entry.meta } : null;
  }

  /**
   * Lista los nombres registrados.
   *
   * @returns {string[]}
   */
  list() {
    return [...this._entries.keys()];
  }

  /**
   * Lista entradas completas (nombre + meta). No expone la función.
   *
   * @returns {Array<{ name: string, meta: Record<string, unknown> }>}
   */
  describe() {
    return [...this._entries.entries()].map(([name, { meta }]) => ({
      name,
      meta: { ...meta },
    }));
  }

  /**
   * Elimina un adapter del registry.
   *
   * @param {string} name
   * @returns {boolean}
   */
  unregister(name) {
    return this._entries.delete(name);
  }
}

/**
 * Construye un AdapterRegistry con los 3 adapters CLI built-in de KJR:
 * claude, codex, gemini. Los adapters se importan dinámicamente para
 * permitir a los consumidores crear registries vacíos cuando quieran
 * testear con fakes.
 *
 * @returns {Promise<AdapterRegistry>}
 */
export async function createDefaultAdapterRegistry() {
  const registry = new AdapterRegistry();
  const [{ runClaudeCli }, { runCodexCli }, { runGeminiCli }] = await Promise.all([
    import('./adapters/claude-cli-adapter.js'),
    import('./adapters/codex-cli-adapter.js'),
    import('./adapters/gemini-cli-adapter.js'),
  ]);
  registry.register('claude', runClaudeCli, {
    bin: 'claude',
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  });
  registry.register('codex', runCodexCli, {
    bin: 'codex',
    installUrl: 'https://developers.openai.com/codex/cli',
  });
  registry.register('gemini', runGeminiCli, {
    bin: 'gemini',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  });
  return registry;
}
