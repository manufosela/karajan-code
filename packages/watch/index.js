// @ts-check
/**
 * karajan-watch — API pública del paquete.
 *
 * Barrel de re-exports sin side effects.
 */
export {
  ConfigError,
  loadConfig,
  validateConfig,
  VALID_STORES,
  VALID_EMBEDDERS,
  VALID_NOTIFY_TYPES,
} from './src/config.js';
export { IngestError, buildIngestPlan, verifyWorkspace, runIngest } from './src/ingest.js';
export { DiffError, parseUnifiedDiff } from './src/diff.js';
export { RetrievalError, findImpactCandidates } from './src/retrieval.js';
export { CoChangeError, correlateCoChanges, readRepoHistory } from './src/cochanges.js';
export {
  JudgmentError,
  SEVERITIES,
  buildJudgmentPrompt,
  parseVerdict,
  judgeImpact,
} from './src/judgment.js';
export {
  NotifyError,
  buildImpactRanking,
  renderImpactMarkdown,
  deliverNotifications,
} from './src/report.js';
export {
  ImpactError,
  extractAdapterText,
  createDefaultRunAdapter,
  runImpactPipeline,
} from './src/impact.js';
export { DOC_EXTENSIONS, runDriftPipeline } from './src/drift.js';
export {
  GoldenSetError,
  validateGoldenSet,
  evaluateRanking,
  runGoldenEval,
  loadGoldenSet,
} from './src/eval.js';
