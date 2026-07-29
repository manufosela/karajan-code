// @ts-check
/**
 * F3 — deriva de documentación.
 *
 * Mismo esqueleto que el pipeline de impacto (F2) con el corpus `docs`
 * como objetivo: los chunks del diff mergeado se consultan contra la
 * documentación y el informe lista qué secciones mencionan lo cambiado
 * y pueden quedar desactualizadas, con enlace fichero+línea.
 *
 * Workaround de KJR-PRP-0004 (queryIndex no expone sourceType): los hits
 * se filtran post-hoc a ficheros de documentación por extensión. El
 * juicio LLM es OPCIONAL (`judge: true`): la deriva es una señal
 * informativa y el default evita coste LLM; cuando se activa, reutiliza
 * el juicio de F2 con la policy del config.
 */
import { extname } from 'node:path';
import { createRag, createDefaultSensitivityPolicy, redactPII } from 'karajan-rag';
import { parseUnifiedDiff } from './diff.js';
import { findImpactCandidates } from './retrieval.js';
import { judgeImpact } from './judgment.js';
import { deliverNotifications } from './report.js';
import { ImpactError, createDefaultRunAdapter } from './impact.js';

/** Extensiones consideradas documentación (workaround KJR-PRP-0004). */
export const DOC_EXTENSIONS = Object.freeze(['.md', '.mdx', '.rst', '.txt', '.adoc']);

/**
 * @typedef {Object} DriftSection
 * @property {string} source Fichero de docs (`repo/path`).
 * @property {string} repo
 * @property {number} score
 * @property {number | null} line Línea aproximada de la sección.
 * @property {import('./retrieval.js').ImpactCandidate['evidence']} evidence
 * @property {{severity: 'low' | 'medium' | 'high', reason: string} | null} judged
 *
 * @typedef {Object} DriftResult
 * @property {DriftSection[]} sections
 * @property {string} markdown
 * @property {number} delivered
 */

/**
 * Renderiza el informe de deriva. Todo el texto pasa por redactPII.
 *
 * @param {Object} params
 * @param {DriftSection[]} params.sections
 * @param {string} params.diffSummary
 * @returns {string}
 */
const renderDriftMarkdown = ({ sections, diffSummary }) => {
  const lines = [
    '## karajan-watch — documentación posiblemente desactualizada',
    '',
    `**Cambio:** ${diffSummary}`,
    '',
  ];
  if (sections.length === 0) {
    lines.push(
      'Sin secciones de documentación afectadas con las señales actuales ' +
        '(hits de código y del repo origen quedan filtrados).',
    );
  } else {
    lines.push('Secciones que mencionan lo cambiado (señales, no certezas):', '');
    for (const section of sections) {
      const anchor = section.line == null ? section.source : `${section.source}:${section.line}`;
      const parts = [`score ${section.score.toFixed(2)}`];
      if (section.judged) {
        parts.push(`juicio: **${section.judged.severity}** — ${section.judged.reason}`);
      }
      lines.push(`- \`${anchor}\` · ${parts.join(' · ')}`);
      for (const ev of section.evidence) {
        lines.push(`  - visto desde \`${ev.fromChunk.path}@${ev.fromChunk.newStart}\``);
      }
    }
  }
  return redactPII(lines.join('\n')).text;
};

/**
 * Ejecuta el pipeline de deriva de docs para el diff de un merge.
 *
 * @param {Object} params
 * @param {import('./config.js').WatchConfig} params.config
 * @param {string} params.workspaceDir
 * @param {string} params.repoName Repo origen del merge.
 * @param {string} params.diffText
 * @param {boolean} [params.judge] Activar el juicio LLM de filtrado (default false).
 * @param {boolean} [params.deliver] Entregar a notify.targets (default true).
 * @param {{repoSlug: string, prNumber: number, token: string}} [params.prContext]
 * @param {Record<string, string | undefined>} [params.env]
 * @param {import('./impact.js').ImpactDeps} [params.deps]
 * @returns {Promise<DriftResult>}
 */
export const runDriftPipeline = async ({
  config,
  workspaceDir,
  repoName,
  diffText,
  judge = false,
  deliver = true,
  prContext,
  env = process.env,
  deps = {},
}) => {
  if (!config.repos.some((r) => r.name === repoName)) {
    throw new ImpactError(`el repo "${repoName}" no está declarado en el config.`);
  }
  const corpus = config.corpus.docs;
  const chunks = parseUnifiedDiff(diffText, { repoName });

  const ragFactory = deps.createRag ?? createRag;
  /** @type {{query: Function, close?: () => Promise<void>} | null} */
  let ownedRag = null;
  /** @type {import('./retrieval.js').QueryFn} */
  let query;
  if (deps.query) {
    query = deps.query;
  } else {
    ownedRag = await ragFactory({
      rootDir: workspaceDir,
      store: corpus.store,
      embedder: corpus.embedder,
      env: /** @type {never} */ (env),
    });
    query = (question, options) => /** @type {never} */ (ownedRag).query(question, options);
  }

  try {
  const { candidates } = await findImpactCandidates({ chunks, query });
  // findImpactCandidates ya excluye el repo origen; el filtro explícito
  // aquí es defensa en profundidad exigida por la review (el informe de
  // deriva jamás debe señalar docs del propio repo que cambió).
  const docCandidates = candidates.filter(
    (c) => c.repo !== repoName && DOC_EXTENSIONS.includes(extname(c.source).toLowerCase()),
  );

  /** @type {Map<string, {severity: 'low' | 'medium' | 'high', reason: string}>} */
  let judgedBySource = new Map();
  if (judge && docCandidates.length > 0) {
    const diffSummaryForJudge = `${repoName}: ${[...new Set(chunks.map((c) => c.path))].join(', ')}`;
    const { verdict } = await judgeImpact({
      candidates: docCandidates,
      coChanges: { byRepo: [], noSignal: [] },
      diffSummary: diffSummaryForJudge,
      sensitivity: corpus.sensitivity,
      policy: config.policy ?? createDefaultSensitivityPolicy(),
      runAdapter: deps.runAdapter ?? createDefaultRunAdapter(),
    });
    judgedBySource = new Map(
      verdict.affected.map((a) => [a.source, { severity: a.severity, reason: a.reason }]),
    );
  }

  const sections = docCandidates
    // Con juicio activo, el veredicto es el filtro de ruido: solo lo afectado.
    .filter((c) => !judge || judgedBySource.has(c.source))
    .map((c) => ({
      source: c.source,
      repo: c.repo,
      score: c.score,
      line: c.evidence[0]?.line ?? null,
      evidence: c.evidence,
      judged: judgedBySource.get(c.source) ?? null,
    }));

  const touchedPaths = [...new Set(chunks.map((c) => c.path))];
  const markdown = renderDriftMarkdown({
    sections,
    diffSummary: `${repoName}: ${touchedPaths.join(', ')} (${chunks.length} chunks)`,
  });

  let delivered = 0;
  const targets = config.notify?.targets ?? [];
  if (deliver && targets.length > 0) {
    delivered = await deliverNotifications({
      markdown,
      targets,
      prContext,
      fetchFn: /** @type {never} */ (deps.fetchFn),
    });
  }

  return { sections, markdown, delivered };
  } finally {
    await ownedRag?.close?.();
  }
};
