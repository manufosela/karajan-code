// @ts-check
/**
 * F2 — pipeline de impacto end-to-end.
 *
 * Orquesta las cinco piezas ya existentes: diff → retrieval → co-cambios
 * → juicio LLM → ranking + aviso. Todas las dependencias con efectos
 * (query al corpus, adapter LLM, fetch, lectura de historial git) son
 * inyectables; los defaults hacen el wiring real con karajan-rag.
 *
 * Cualquier señal fallida aborta el pipeline (sin informes parciales
 * silenciosos); la única señal opcional por naturaleza es el co-cambio,
 * que degrada a `noSignal` EXPLÍCITO cuando no hay historial.
 */
import { join } from 'node:path';
import {
  createRag,
  createDefaultAdapterRegistry,
  createDefaultSensitivityPolicy,
} from 'karajan-rag';
import { parseUnifiedDiff } from './diff.js';
import { findImpactCandidates } from './retrieval.js';
import { correlateCoChanges, readRepoHistory, CoChangeError } from './cochanges.js';
import { judgeImpact } from './judgment.js';
import { extractContractTokens, findContractMatches } from './contracts.js';
import { buildImpactRanking, renderImpactMarkdown, deliverNotifications } from './report.js';
import { announceDefaults } from './config.js';
import { appendReport } from './history.js';

/** Error de orquestación del pipeline de impacto. */
export class ImpactError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'ImpactError';
  }
}

/**
 * Extrae el texto de un AdapterResult de karajan-rag. Estricto: si no hay
 * texto utilizable lanza — nunca una cadena de fallbacks silenciosa.
 *
 * @param {unknown} result
 * @returns {string}
 */
export const extractAdapterText = (result) => {
  if (result && typeof result === 'object') {
    const parsed = /** @type {{parsedOutput?: {text?: unknown}, process?: {stdout?: unknown}}} */ (
      result
    );
    if (typeof parsed.parsedOutput?.text === 'string' && parsed.parsedOutput.text.length > 0) {
      return parsed.parsedOutput.text;
    }
    if (typeof parsed.process?.stdout === 'string' && parsed.process.stdout.length > 0) {
      return parsed.process.stdout;
    }
  }
  throw new ImpactError('el adapter no devolvió texto utilizable (ni parsedOutput ni stdout).');
};

/**
 * runAdapter por defecto: registry de adapters de karajan-rag.
 * Compartido por los pipelines de impacto (F2) y deriva (F3).
 *
 * @returns {(adapterName: string, prompt: string) => Promise<string>}
 */
export const createDefaultRunAdapter = () => {
  /** @type {import('karajan-rag').AdapterRegistry | null} */
  let registry = null;
  return async (adapterName, prompt) => {
    registry ??= await createDefaultAdapterRegistry();
    const adapterFn = registry.get(adapterName);
    return extractAdapterText(await adapterFn(prompt));
  };
};

/**
 * @typedef {Object} ImpactDeps
 * @property {import('./retrieval.js').QueryFn} [query]
 * @property {(adapterName: string, prompt: string) => Promise<string>} [runAdapter]
 * @property {(url: string, options: never) => Promise<{ok: boolean, status: number}>} [fetchFn]
 * @property {(repoDir: string) => Promise<import('./cochanges.js').RepoCommit[]>} [readHistory]
 * @property {(options: Record<string, unknown>) => Promise<{query: Function, close?: () => Promise<void>}>} [createRag] Factoría del RAG, inyectable para poder verificar que se cierra.
 *
 * @typedef {Object} ImpactResult
 * @property {import('./report.js').RankingEntry[]} ranking
 * @property {import('./contracts.js').ContractMatch[]} contracts
 * @property {import('./cochanges.js').CoChangeResult} coChanges
 * @property {import('./judgment.js').Verdict} verdict
 * @property {string} markdown
 * @property {number} delivered
 */

/**
 * Ejecuta el pipeline de impacto completo para el diff de un merge.
 *
 * @param {Object} params
 * @param {import('./config.js').WatchConfig} params.config
 * @param {string} params.workspaceDir Workspace multi-repo (convención de docs/ingest.md).
 * @param {string} params.repoName Repo origen del merge.
 * @param {string} params.diffText Diff unificado del merge.
 * @param {'code' | 'docs'} [params.corpusName]
 * @param {boolean} [params.judge] Ejecutar el juicio LLM (default true). Con false el veredicto queda vacío y no se toca ningún adapter — señales puras (eval, despliegues sin LLM).
 * @param {boolean} [params.deliver] Entregar a notify.targets (default true).
 * @param {{repoSlug: string, prNumber: number, token: string}} [params.prContext]
 * @param {Record<string, string | undefined>} [params.env]
 * @param {ImpactDeps} [params.deps]
 * @param {(msg: string) => void} [params.log] Progreso por fase: sin esto el pipeline es una caja negra en CI (KJW-BUG-0004).
 * @returns {Promise<ImpactResult>}
 */
export const runImpactPipeline = async ({
  config,
  workspaceDir,
  repoName,
  diffText,
  corpusName = 'code',
  judge = true,
  deliver = true,
  prContext,
  env = process.env,
  deps = {},
  log = (msg) => console.error(`[kjw-impact] ${msg}`),
}) => {
  const repo = config.repos.find((r) => r.name === repoName);
  if (!repo) {
    throw new ImpactError(`el repo "${repoName}" no está declarado en el config.`);
  }
  const corpus = config.corpus[corpusName];

  const chunks = parseUnifiedDiff(diffText, { repoName });

  // Quien abre el recurso lo cierra: si el query viene inyectado es de
  // quien lo pasó y no nos corresponde tocarlo (KJW-BUG-0007).
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
  announceDefaults(config, log);
  log(`diff: ${chunks.length} chunks`);
  const { candidates } = await findImpactCandidates({ chunks, query });
  log(`retrieval: ${candidates.length} candidatos`);

  // Señal 4: contratos. Reutiliza la misma query, así que no añade infra.
  const contractsConfig = config.contracts ?? { enabled: true, types: undefined };
  let contracts = [];
  if (contractsConfig.enabled) {
    const tokens = extractContractTokens(chunks, { types: contractsConfig.types });
    ({ matches: contracts } = await findContractMatches({
      tokens,
      query,
      excludeRepo: repoName,
    }));
    log(`contratos: ${tokens.length} identificadores → ${contracts.length} coincidencias`);
  }

  // Señal de co-cambios: historial del origen + de cada target declarado.
  // Un repo cuyo historial no se puede leer queda como noSignal explícito.
  const readHistory = deps.readHistory ?? readRepoHistory;
  const touchedPaths = [...new Set(chunks.map((c) => c.path))];
  /** @type {import('./cochanges.js').RepoHistory} */
  let origin;
  try {
    origin = { name: repoName, commits: await readHistory(join(workspaceDir, repoName)) };
  } catch (err) {
    if (!(err instanceof CoChangeError)) throw err;
    origin = { name: repoName, commits: [] };
  }
  /** @type {import('./cochanges.js').RepoHistory[]} */
  const targets = [];
  for (const target of config.repos.filter((r) => r.name !== repoName)) {
    try {
      targets.push({
        name: target.name,
        commits: await readHistory(join(workspaceDir, target.name)),
      });
    } catch (err) {
      if (!(err instanceof CoChangeError)) throw err;
      targets.push({ name: target.name, commits: [] });
    }
  }
  const coChanges = correlateCoChanges({ origin, targets, touchedPaths });
  log(`co-cambios: ${coChanges.byRepo.length} con señal, ${coChanges.noSignal.length} sin ella`);

  const diffSummary = `${repoName}: ${touchedPaths.join(', ')} (${chunks.length} chunks)`;
  if (judge) log('juicio: pidiendo veredicto al adapter…');
  const judgment = judge
    ? await judgeImpact({
        candidates,
        coChanges,
        diffSummary,
        sensitivity: corpus.sensitivity,
        policy: config.policy ?? createDefaultSensitivityPolicy(),
        contracts,
        runAdapter: deps.runAdapter ?? createDefaultRunAdapter(),
      })
    : { verdict: { summary: '', affected: [] }, discardedEntries: 0 };
  const { verdict } = judgment;
  // KJW-BUG-0010: lo descartado y lo no-juzgado se DICE — es la diferencia
  // entre medir la guarda y que sus efectos pasen en silencio.
  if (judgment.insufficientSignal) log('juicio: sin señal suficiente — veredicto no pedido');
  if (judgment.discardedEntries > 0) {
    log(`juicio: ${judgment.discardedEntries} entrada(s) sin respaldo descartada(s)`);
  }

  const ranking = buildImpactRanking({
    candidates,
    coChanges,
    verdict,
    contracts,
    thresholds: config.impact?.thresholds ?? {},
  });
  const markdown = renderImpactMarkdown({
    ranking,
    diffSummary,
    verdictSummary: verdict.summary,
  });

  let delivered = 0;
  const targetsToNotify = config.notify?.targets ?? [];
  if (deliver && targetsToNotify.length > 0) {
    delivered = await deliverNotifications({
      markdown,
      targets: targetsToNotify,
      prContext,
      fetchFn: /** @type {never} */ (deps.fetchFn),
    });
  }

  // El comentario de la PR es efímero; el histórico permite mirar la
  // evolución después. Opt-in: sin la sección `history` esto es un no-op.
  const persisted = await appendReport({
    config,
    workspaceDir,
    report: {
      kind: 'impact',
      repo: repoName,
      diffSummary,
      measuredWith: { store: corpus.store, embedder: corpus.embedder },
      entries: ranking,
    },
  });
  if (persisted.persisted) log(`historial: informe guardado en ${persisted.path}`);

  return { ranking, contracts, coChanges, verdict, markdown, delivered };
  } finally {
    await ownedRag?.close?.();
  }
};
