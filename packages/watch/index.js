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
