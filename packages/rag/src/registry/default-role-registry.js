// @ts-check
import { RoleRegistry } from '../pipeline/role-registry.js';
import { RetrieverRole } from '../retrieval/retriever-role.js';
import { RerankerRole } from '../retrieval/reranker-role.js';
import { GeneratorRole } from '../generation/generator-role.js';
import { EvaluatorRole } from '../evaluation/evaluator-role.js';
import { RedactionRole } from '../redaction/redaction-role.js';

/**
 * @typedef {import('../embedding/embedder.js').Embedder} Embedder
 * @typedef {import('../vector-store/in-memory-vector-store.js').InMemoryVectorStore} InMemoryVectorStore
 * @typedef {import('../retrieval/bm25.js').BM25Index} BM25Index
 * @typedef {import('../ai/adapter-registry.js').AdapterRegistry} AdapterRegistry
 * @typedef {import('../pipeline/types.js').Logger} Logger
 * @typedef {import('../policy/sensitivity-policy.js').SensitivityPolicy} SensitivityPolicy
 */

/**
 * @typedef {Object} DefaultRoleRegistryOptions
 * @property {Logger} logger Logger compartido por todos los roles.
 * @property {Embedder} [embedder] Para RetrieverRole.
 * @property {{ search: (v: number[], opts?: object) => any[] }} [store] Para RetrieverRole.
 * @property {BM25Index} [bm25] Para hybrid/bm25 en RetrieverRole.
 * @property {AdapterRegistry} [adapterRegistry] Para Generator/Evaluator/Reranker.
 * @property {string} [generationProvider] Nombre del adapter para generation (default 'claude').
 * @property {string[]} [evaluationProviders] Providers para EvaluatorRole (default los 3 públicos).
 * @property {SensitivityPolicy} [policy] Para RedactionRole.
 * @property {string} [targetProvider] Para RedactionRole (default igual a generationProvider).
 * @property {"vector" | "hybrid" | "bm25"} [retrievalMode]
 * @property {number} [hybridAlpha]
 * @property {number} [similarityThreshold]
 * @property {number} [defaultTopK]
 * @property {boolean} [forceCitation]
 */

/**
 * Crea un RoleRegistry con los 5 roles built-in (retriever, reranker,
 * generator, evaluator, redaction) ya configurados para usarse desde
 * pipelines declarativos (JSON).
 *
 * Cada rol se registra como **factory** que devuelve una instancia
 * nueva por pipeline run (ver RoleRegistry). Los roles dependen de
 * servicios inyectados vía options; si alguno falta, el rol
 * correspondiente no se registra (consumer decide si lo necesita).
 *
 * @param {DefaultRoleRegistryOptions} options
 * @returns {RoleRegistry}
 */
export function createDefaultRoleRegistry(options) {
  if (!options || !options.logger) {
    throw new Error('createDefaultRoleRegistry: "logger" requerido.');
  }
  const logger = options.logger;
  const registry = new RoleRegistry();

  if (options.embedder && options.store) {
    registry.register(
      'retriever',
      () =>
        new RetrieverRole({
          name: 'retriever',
          logger,
          embedder: options.embedder,
          store: options.store,
          bm25: options.bm25,
          mode: options.retrievalMode ?? 'vector',
          hybridAlpha: options.hybridAlpha ?? 0.5,
          similarityThreshold: options.similarityThreshold,
          defaultTopK: options.defaultTopK ?? 5,
        }),
    );
  }

  if (options.adapterRegistry) {
    const genProvider = options.generationProvider ?? 'claude';
    registry.register(
      'reranker-score',
      () => new RerankerRole({ name: 'reranker-score', logger, mode: 'score' }),
    );
    if (options.adapterRegistry.has?.(genProvider)) {
      const adapter = options.adapterRegistry.get(genProvider);
      registry.register(
        'reranker-llm',
        () =>
          new RerankerRole({
            name: 'reranker-llm',
            logger,
            mode: 'llm',
            adapter,
          }),
      );
      registry.register(
        'generator',
        () =>
          new GeneratorRole({
            name: 'generator',
            logger,
            adapter,
            forceCitation: options.forceCitation ?? true,
          }),
      );
    }
    const evalProviders =
      options.evaluationProviders ??
      (['claude', 'codex', 'gemini'].filter((p) =>
        options.adapterRegistry.has?.(p),
      ));
    if (evalProviders.length > 0) {
      registry.register(
        'evaluator',
        () =>
          new EvaluatorRole({
            name: 'evaluator',
            logger,
            registry: options.adapterRegistry,
            providers: evalProviders,
          }),
      );
    }
  }

  if (options.policy) {
    const target = options.targetProvider ?? options.generationProvider ?? 'claude';
    registry.register(
      'redaction',
      () =>
        new RedactionRole({
          name: 'redaction',
          logger,
          policy: options.policy,
          targetProvider: target,
        }),
    );
  }

  return registry;
}
