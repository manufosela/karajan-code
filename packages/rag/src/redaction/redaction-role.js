// @ts-check
import { Role } from '../pipeline/role.js';
import { redactPII } from './pii-redactor.js';
import { classifySensitivity } from '../domain/document.js';
import { isProviderAllowed } from '../policy/sensitivity-policy.js';

/**
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('../pipeline/types.js').ToolBox} ToolBox
 * @typedef {import('../policy/sensitivity-policy.js').SensitivityPolicy} SensitivityPolicy
 */

/**
 * RedactionRole — Stage 2.5 entre retrieval y generation.
 *
 * Responsabilidades:
 * 1. Verificar que la sensibilidad de cada chunk es compatible con el
 *    targetProvider según la policy. Si algún chunk rompe la policy,
 *    lanza con mensaje claro ANTES de invocar al GeneratorRole.
 * 2. Aplicar redactPII sobre el contenido de cada chunk (defensa en
 *    profundidad aunque la policy ya permita).
 * 3. Devolver chunks saneados + un report { redacted, counts }.
 */
export class RedactionRole extends Role {
  /**
   * @param {{
   *   name: string,
   *   logger: import('../pipeline/types.js').Logger,
   *   policy: SensitivityPolicy,
   *   targetProvider: string,
   *   redactor?: typeof redactPII,
   * }} opts
   */
  constructor(opts) {
    super({ name: opts.name, logger: opts.logger });
    if (!opts.policy) throw new Error('RedactionRole: "policy" requerida.');
    if (typeof opts.targetProvider !== 'string' || opts.targetProvider.length === 0) {
      throw new Error('RedactionRole: "targetProvider" requerido.');
    }
    this.policy = opts.policy;
    this.targetProvider = opts.targetProvider;
    this.redactor = opts.redactor ?? redactPII;
  }

  /**
   * @param {{ query: string, contextChunks?: SearchHit[] }} input
   * @param {ToolBox} _tools
   * @returns {Promise<{ query: string, contextChunks: SearchHit[], report: { redacted: number, counts: Record<string, number>, blockedBy: string[] } }>}
   */
   
  async run(input, _tools) {
    if (!input || typeof input.query !== 'string') {
      throw new Error('RedactionRole.run: input.query requerido.');
    }
    const chunks = input.contextChunks ?? [];

    // 1) Policy check: si algún chunk tiene sensitivity no permitida al target → bloquear.
    /** @type {string[]} */
    const blockedBy = [];
    for (const chunk of chunks) {
      const level = classifySensitivity(chunk);
      if (!isProviderAllowed(this.policy, level, this.targetProvider)) {
        blockedBy.push(`${chunk.id} (${level})`);
      }
    }
    if (blockedBy.length > 0) {
      throw new Error(
        `RedactionRole: bloqueado por policy. Target "${this.targetProvider}" no permitido para chunks: ${blockedBy.join(', ')}`,
      );
    }

    // 2) Redacción PII sobre cada chunk.
    /** @type {SearchHit[]} */
    const sanitized = [];
    /** @type {Record<string, number>} */
    const totalCounts = {};
    let redactedCount = 0;
    for (const chunk of chunks) {
      const original = String(chunk.metadata?.content ?? '');
      const report = this.redactor(original);
      if (report.total > 0) redactedCount += 1;
      for (const [k, v] of Object.entries(report.counts)) {
        totalCounts[k] = (totalCounts[k] ?? 0) + /** @type {number} */ (v);
      }
      sanitized.push({
        ...chunk,
        metadata: {
          ...chunk.metadata,
          content: report.text,
          piiRedacted: report.total,
        },
      });
    }

    this.logger.info?.(
      `redaction: ${redactedCount}/${chunks.length} chunks con PII redactada`,
    );

    return {
      query: input.query,
      contextChunks: sanitized,
      report: { redacted: redactedCount, counts: totalCounts, blockedBy: [] },
    };
  }
}
