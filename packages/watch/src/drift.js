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
import { extractContractTokens, findContractMatches } from './contracts.js';
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
 * @property {import('./contracts.js').ContractMatch | null} contract Cita literal de un identificador del diff.
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
      if (section.contract) {
        // Lo primero que se lee: qué identificador cita el documento, y si
        // ya no existe en el código. Eso es lo accionable.
        const ids = section.contract.tokens
          .map((t) => `\`${t.value}\` (${t.type}${t.removed ? ', eliminado' : ''})`)
          .join(', ');
        parts.unshift(`**contrato**: ${ids}`);
      }
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
  // La documentación que primero queda mintiendo es la que vive AL LADO del
  // código: excluir el repo origen —correcto para el impacto cross-repo— la
  // escondía justo en el caso más común, el README junto al código. Lo que
  // se deja fuera son los ficheros que el propio diff tocó: esos no son
  // documentación desactualizada, son el cambio.
  const touchedSources = new Set(
    chunks.flatMap((c) =>
      [c.path, c.oldPath].filter(Boolean).map((p) => `${repoName}/${p}`),
    ),
  );
  const { candidates } = await findImpactCandidates({
    chunks,
    query,
    excludeRepo: null,
    excludeSources: touchedSources,
  });
  const isDoc = (source) => DOC_EXTENSIONS.includes(extname(source).toLowerCase());
  const docCandidates = candidates.filter((c) => isDoc(c.source));

  // La similitud dice "este documento se parece a lo que cambiaste". El
  // contrato dice "este documento nombra el endpoint que acabas de borrar",
  // que no es parecido: es prueba de que el documento miente. Se buscan los
  // mismos identificadores que en F2, pero contra el corpus de docs.
  const contractsConfig = config.contracts ?? { enabled: true, types: undefined };
  /** @type {import('./contracts.js').ContractMatch[]} */
  let contracts = [];
  if (contractsConfig.enabled) {
    const tokens = extractContractTokens(chunks, { types: contractsConfig.types });
    const { matches } = await findContractMatches({
      tokens,
      query,
      excludeRepo: null,
      excludeSources: touchedSources,
    });
    // Un consumidor de código que cita el identificador es cosa del pipeline
    // de impacto; aquí solo interesa la documentación.
    contracts = matches.filter((m) => isDoc(m.source));
  }
  // Una entrada por documento, con TODOS sus identificadores. Hoy
  // findContractMatches ya los agrupa así, pero agrupar aquí también evita
  // que la deriva dependa de esa invariante ajena: perder un token sería
  // perder justo el identificador eliminado que da sentido al aviso.
  /** @type {Map<string, import('./contracts.js').ContractMatch>} */
  const contractBySource = new Map();
  for (const match of contracts) {
    const existing = contractBySource.get(match.source);
    if (!existing) {
      contractBySource.set(match.source, { ...match, tokens: [...match.tokens] });
      continue;
    }
    for (const token of match.tokens) {
      if (!existing.tokens.some((t) => t.value === token.value && t.type === token.type)) {
        existing.tokens.push(token);
      }
    }
    existing.line ??= match.line;
  }

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

  /** @type {DriftSection[]} */
  const sections = docCandidates
    // Con juicio activo, el veredicto es el filtro de ruido: solo lo afectado.
    // Una cita literal, en cambio, no la tumba una opinión: el documento
    // nombra algo que ya no existe, opine lo que opine el modelo.
    .filter((c) => !judge || judgedBySource.has(c.source) || contractBySource.has(c.source))
    .map((c) => ({
      source: c.source,
      repo: c.repo,
      score: c.score,
      line: c.evidence[0]?.line ?? null,
      evidence: c.evidence,
      judged: judgedBySource.get(c.source) ?? null,
      contract: contractBySource.get(c.source) ?? null,
    }));

  // Un documento puede citar el identificador sin parecerse en nada al diff:
  // entra por derecho propio aunque el retrieval no lo hubiera traído.
  const alreadyListed = new Set(sections.map((s) => s.source));
  for (const match of contractBySource.values()) {
    if (alreadyListed.has(match.source)) continue;
    sections.push({
      source: match.source,
      repo: match.repo,
      score: 0,
      line: match.line,
      evidence: [],
      judged: judgedBySource.get(match.source) ?? null,
      contract: match,
    });
  }

  /** Documento que cita algo ya eliminado > que lo cita > solo parecido. */
  const contractRank = (section) => {
    if (!section.contract) return 0;
    return section.contract.tokens.some((t) => t.removed) ? 2 : 1;
  };
  sections.sort((a, b) => contractRank(b) - contractRank(a) || b.score - a.score);

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
