// @ts-check
import { Role } from '../pipeline/role.js';
import { evaluateMultiJudge } from './multi-judge-evaluator.js';

/**
 * @typedef {import('../ai/adapter-registry.js').AdapterRegistry} AdapterRegistry
 * @typedef {import('../pipeline/types.js').ToolBox} ToolBox
 * @typedef {import('./multi-judge-evaluator.js').EvaluationReport} EvaluationReport
 */

/**
 * EvaluatorRole — envuelve evaluateMultiJudge como Stage de primera clase del
 * pipeline. Recibe el output del GeneratorRole (u otro role con { query,
 * answer, context? }) y produce un EvaluationReport.
 *
 * Publica el reporte también en ctx.metadata.evaluation para consumidores
 * posteriores (p. ej. stages de alertas o post-proceso).
 */
export class EvaluatorRole extends Role {
  /**
   * @param {{
   *   name: string,
   *   logger: import('../pipeline/types.js').Logger,
   *   registry: AdapterRegistry,
   *   providers: string[],
   *   disagreementThreshold?: number,
   * }} opts
   */
  constructor(opts) {
    super({ name: opts.name, logger: opts.logger });
    if (!opts.registry) throw new Error('EvaluatorRole: "registry" requerido.');
    if (!Array.isArray(opts.providers) || opts.providers.length === 0) {
      throw new Error('EvaluatorRole: "providers" debe ser array no vacío.');
    }
    this.registry = opts.registry;
    this.providers = [...opts.providers];
    this.disagreementThreshold = opts.disagreementThreshold ?? 0.3;
  }

  /**
   * @param {{ query: string, answer: string, context?: string, contextChunks?: Array<{ metadata?: Record<string, unknown> }> }} input
   * @param {ToolBox} _tools
   * @returns {Promise<EvaluationReport>}
   */
   
  async run(input, _tools) {
    if (!input || typeof input.query !== 'string' || typeof input.answer !== 'string') {
      throw new Error('EvaluatorRole.run: se requieren input.query e input.answer.');
    }
    const context =
      input.context ??
      (Array.isArray(input.contextChunks)
        ? input.contextChunks
            .map((c, i) => `[${i + 1}] ${String(c?.metadata?.content ?? '')}`)
            .join('\n')
        : undefined);

    const report = await evaluateMultiJudge({
      registry: this.registry,
      providers: this.providers,
      input: { query: input.query, answer: input.answer, context },
      disagreementThreshold: this.disagreementThreshold,
    });
    this.logger.info?.(
      `evaluator: aggregate=${report.aggregateScore} disagreement=${report.disagreement}`,
    );
    return report;
  }
}
