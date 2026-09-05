// @ts-check
/**
 * F2 — ranking de riesgo con evidencia y emisión de avisos.
 *
 * Combina las tres señales (retrieval, co-cambios, juicio LLM) en un
 * ranking honesto: cada entrada presenta SU evidencia — score de
 * similitud, co-cambios históricos con conteos y el juicio con su razón.
 * Nunca una "probabilidad" calibrada: la similitud vectorial no da eso.
 *
 * El informe en markdown pasa entero por redactPII antes de salir, y la
 * entrega a los destinos configurados intenta TODOS los targets: los
 * fallos se agregan y lanzan {@link NotifyError} (job rojo) — nunca se
 * salta un destino en silencio.
 */
import { redactPII } from 'karajan-rag';

/** Error de emisión de avisos. */
export class NotifyError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'NotifyError';
  }
}

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

/**
 * @typedef {import('./retrieval.js').ImpactCandidate} ImpactCandidate
 * @typedef {import('./cochanges.js').CoChangeResult} CoChangeResult
 * @typedef {import('./judgment.js').Verdict} Verdict
 * @typedef {import('./config.js').NotifyTarget} NotifyTarget
 *
 * @typedef {Object} RankingEntry
 * @property {string} source
 * @property {string} repo
 * @property {number} score Score de similitud (máximo entre evidencias).
 * @property {ImpactCandidate['evidence']} evidence
 * @property {{count: number, lastDate: string} | null} coChange Señal de co-cambios para este path, si existe.
 * @property {{severity: 'low' | 'medium' | 'high', reason: string} | null} judged Juicio LLM, si lo hay.
 * @property {import('./contracts.js').ContractMatch | null} contract Contrato compartido con el diff, si lo hay.
 * @property {'file' | 'repo'} [scope] `repo` cuando la fila es un veredicto de
 *   alcance repositorio (KJW-BUG-0009) — `source` es entonces el nombre del repo.
 */

/**
 * Combina señales en un ranking: severidad juzgada primero, score después.
 *
 * @param {Object} params
 * @param {ImpactCandidate[]} params.candidates
 * @param {CoChangeResult} params.coChanges
 * @param {Verdict} params.verdict
 * @param {import('./contracts.js').ContractMatch[]} [params.contracts] Coincidencias de contrato (señal 4).
 * @param {{minSimilarity?: number, maxCandidates?: number}} [params.thresholds]
 * @returns {RankingEntry[]}
 */
export const buildImpactRanking = ({
  candidates,
  coChanges,
  verdict,
  contracts = [],
  thresholds = {},
}) => {
  // Los veredictos de alcance repo NO se cuelgan de un fichero (KJW-BUG-0009):
  // entran al ranking como filas propias, más abajo.
  const fileVerdicts = verdict.affected.filter((a) => a.scope !== 'repo');
  const repoVerdicts = verdict.affected.filter((a) => a.scope === 'repo');
  const judgedBySource = new Map(
    fileVerdicts.map((a) => [a.source, { severity: a.severity, reason: a.reason }]),
  );
  /** @type {Map<string, {count: number, lastDate: string}>} */
  const coChangeBySource = new Map();
  for (const repoEntry of coChanges.byRepo) {
    for (const change of repoEntry.coChanges) {
      coChangeBySource.set(`${repoEntry.repo}/${change.path}`, {
        count: change.count,
        lastDate: change.lastDate,
      });
    }
  }

  const contractBySource = new Map(contracts.map((c) => [c.source, c]));

  const minSimilarity = thresholds.minSimilarity ?? 0;
  /** @type {RankingEntry[]} */
  const entries = candidates
    .filter((c) => c.score >= minSimilarity)
    .map((c) => ({
      source: c.source,
      repo: c.repo,
      score: c.score,
      evidence: c.evidence,
      coChange: coChangeBySource.get(c.source) ?? null,
      judged: judgedBySource.get(c.source) ?? null,
      contract: contractBySource.get(c.source) ?? null,
    }));

  // Un contrato compartido es evidencia de acoplamiento, no parecido: entra
  // al ranking aunque el retrieval no lo hubiera traído (score 0) y aunque
  // quede por debajo del umbral de similitud.
  const alreadyRanked = new Set(entries.map((e) => e.source));
  for (const match of contracts) {
    if (alreadyRanked.has(match.source)) continue;
    entries.push({
      source: match.source,
      repo: match.repo,
      score: 0,
      evidence: [],
      coChange: coChangeBySource.get(match.source) ?? null,
      judged: judgedBySource.get(match.source) ?? null,
      contract: match,
    });
  }

  for (const entry of repoVerdicts) {
    entries.push({
      source: entry.source,
      repo: entry.source,
      score: 0,
      evidence: [],
      coChange: null,
      judged: { severity: entry.severity, reason: entry.reason },
      contract: null,
      scope: 'repo',
    });
  }

  /** Contrato roto (identificador que desapareció) pesa más que uno vigente. */
  const contractRank = (entry) => {
    if (!entry.contract) return 0;
    return entry.contract.tokens.some((t) => t.removed) ? 2 : 1;
  };

  entries.sort(
    (a, b) =>
      contractRank(b) - contractRank(a) ||
      (SEVERITY_RANK[b.judged?.severity ?? ''] ?? 0) -
        (SEVERITY_RANK[a.judged?.severity ?? ''] ?? 0) ||
      b.score - a.score,
  );

  return thresholds.maxCandidates != null
    ? entries.slice(0, thresholds.maxCandidates)
    : entries;
};

/**
 * Renderiza el informe en markdown. TODO el texto pasa por redactPII.
 *
 * @param {Object} params
 * @param {RankingEntry[]} params.ranking
 * @param {string} params.diffSummary
 * @param {string} [params.verdictSummary]
 * @param {import('./inactivity.js').InactivityResult & {thresholdDays: number}} [params.inactivity]
 *   Repos observados inactivos (KJW-TSK-0043) — aviso al pie, nunca gate.
 * @returns {string}
 */
export const renderImpactMarkdown = ({ ranking, diffSummary, verdictSummary, inactivity }) => {
  const lines = [
    '## karajan-watch — posible impacto cross-repo',
    '',
    `**Cambio:** ${diffSummary}`,
  ];
  if (verdictSummary) lines.push('', `**Síntesis del juicio:** ${verdictSummary}`);
  lines.push('');
  if (ranking.length === 0) {
    lines.push('Sin candidatos de impacto fuera del repo origen con las señales actuales.');
  } else {
    lines.push(
      'Ranking por evidencia (similitud + co-cambios + juicio): señales, no certezas.',
      '',
    );
    for (const entry of ranking) {
      const parts = [`score ${entry.score.toFixed(2)}`];
      if (entry.contract) {
        // La evidencia dura primero: qué identificador comparten y de qué tipo.
        const ids = entry.contract.tokens
          .map((t) => `\`${t.value}\` (${t.type}${t.removed ? ', eliminado' : ''})`)
          .join(', ');
        parts.unshift(`**contrato**: ${ids}`);
      }
      if (entry.coChange) {
        parts.push(`co-cambios: ${entry.coChange.count} (último ${entry.coChange.lastDate})`);
      }
      if (entry.judged) {
        parts.push(`juicio: **${entry.judged.severity}** — ${entry.judged.reason}`);
      }
      // Un veredicto de alcance repo se presenta COMO repo — fingir la
      // precisión de un fichero hace que el aviso se descarte por ruido.
      const label = entry.scope === 'repo' ? `repo \`${entry.source}\`` : `\`${entry.source}\``;
      lines.push(`- ${label} · ${parts.join(' · ')}`);
      for (const ev of entry.evidence) {
        lines.push(
          `  - visto desde \`${ev.fromChunk.path}@${ev.fromChunk.newStart}\`` +
            (ev.line == null ? '' : ` (línea ${ev.line})`),
        );
      }
    }
  }
  // KJW-TSK-0043: la config también caduca. Aviso que propone, no que decide.
  if (inactivity && (inactivity.inactive.length > 0 || inactivity.unreadable.length > 0)) {
    lines.push('', `### Repos observados inactivos (umbral: ${inactivity.thresholdDays} días)`, '');
    for (const r of inactivity.inactive) {
      const since = r.lastActivity ? `último merge ${r.lastActivity} (${r.inactiveDays} días)` : 'sin actividad conocida';
      lines.push(`- \`${r.repo}\` — ${since}: retira este repo de la config o confirma que sigue interesando.`);
    }
    for (const name of inactivity.unreadable) {
      lines.push(`- \`${name}\` — historia ilegible: no observable (no se acusa de inactivo lo que no se puede mirar).`);
    }
  }
  return redactPII(lines.join('\n')).text;
};

/**
 * Entrega el informe a los destinos configurados. Intenta todos los
 * targets; cualquier fallo se agrega y lanza NotifyError (job rojo).
 *
 * @param {Object} params
 * @param {string} params.markdown
 * @param {NotifyTarget[]} params.targets
 * @param {{repoSlug: string, prNumber: number, token: string, apiBase?: string}} [params.prContext] Contexto de la PR para targets pr-comment.
 * @param {(url: string, options: {method: string, headers: Record<string, string>, body: string}) => Promise<{ok: boolean, status: number}>} [params.fetchFn]
 * @returns {Promise<number>} Nº de destinos entregados.
 */
export const deliverNotifications = async ({ markdown, targets, prContext, fetchFn = fetch }) => {
  /** @type {string[]} */
  const failures = [];
  let delivered = 0;

  for (const target of targets) {
    try {
      if (target.type === 'webhook') {
        const response = await fetchFn(target.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'karajan-watch', markdown }),
        });
        if (!response.ok) {
          // Solo el host en el mensaje: la URL completa puede llevar tokens.
          throw new NotifyError(
            `webhook ${new URL(target.url).host} respondió ${response.status}.`,
          );
        }
      } else {
        if (!prContext) {
          throw new NotifyError(
            'target pr-comment sin contexto de PR (repoSlug, prNumber, token).',
          );
        }
        const apiBase = prContext.apiBase ?? 'https://api.github.com';
        const url = `${apiBase}/repos/${prContext.repoSlug}/issues/${prContext.prNumber}/comments`;
        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${prContext.token}`,
          },
          body: JSON.stringify({ body: markdown }),
        });
        if (!response.ok) {
          throw new NotifyError(`pr-comment en ${prContext.repoSlug}#${prContext.prNumber} respondió ${response.status}.`);
        }
      }
      delivered += 1;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (failures.length > 0) {
    throw new NotifyError(
      `fallo entregando ${failures.length}/${targets.length} destino(s): ${failures.join(' | ')}`,
    );
  }
  return delivered;
};
