// @ts-check
/**
 * Karajan RAG — API pública.
 *
 * Este módulo es un *barrel* de re-exports. No tiene side effects: importar
 * desde `karajan-rag` no lanza demos ni conecta a ningún servicio.
 *
 * Organización por capa:
 *   - Pipeline: runPipeline, Role, RoleRegistry, utilidades.
 *   - Adapters: Claude/Codex/Gemini/Ollama CLI, Azure OpenAI/Bedrock/Vertex HTTP/SDK,
 *     Ollama stream.
 *   - Ingestion: loaders + chunkers.
 *   - Embedding: Hash/OpenAI-compat/Ollama/Transformers + cache.
 *   - Vector stores: InMemory/Pg/LanceDB.
 *   - Retrieval: BM25, Retriever, Reranker, Solomon, parallelRetrieve, dedupe.
 *   - Generation / Evaluation: Generator, multi-judge.
 *   - Sensitivity policy + redacción PII.
 *   - Config-driven runs.
 *
 * Los ejemplos ejecutables viven en `examples/`; no se exportan desde aquí.
 */

// --- Pipeline -------------------------------------------------------------
export {
  runPipeline,
  createPipelineContext,
  estimateSize,
} from './src/pipeline/pipeline.js';
export { Role, ROLE_EVENTS } from './src/pipeline/role.js';
export { RoleRegistry } from './src/pipeline/role-registry.js';
export { collectPipelineEvents } from './src/pipeline/collect-events.js';

// --- Adapters -------------------------------------------------------------
export { AdapterRegistry, createDefaultAdapterRegistry } from './src/ai/adapter-registry.js';
export { runMultiCli } from './src/ai/multi-cli-orchestrator.js';
export { runCli } from './src/ai/cli-runner.js';
export { parseCliOutput } from './src/ai/output-parser.js';

export { runClaudeCli } from './src/ai/adapters/claude-cli-adapter.js';
export { runCodexCli } from './src/ai/adapters/codex-cli-adapter.js';
export { runGeminiCli } from './src/ai/adapters/gemini-cli-adapter.js';
export { runOllamaCli } from './src/ai/adapters/ollama-cli-adapter.js';
export { runAzureOpenAi } from './src/ai/adapters/azure-openai-adapter.js';
export { runBedrock } from './src/ai/adapters/bedrock-adapter.js';
export { runVertexAi } from './src/ai/adapters/vertex-ai-adapter.js';
export { runOpenAi } from './src/ai/adapters/openai-adapter.js';
export { runAnthropic } from './src/ai/adapters/anthropic-adapter.js';
export { createOllamaClient } from './src/ai/adapters/ollama-client.js';
export {
  createOllamaStreamAdapter,
  readNdjsonLines,
} from './src/ai/adapters/ollama-stream-adapter.js';
export { wrapAdapterAsStream } from './src/ai/adapters/wrap-adapter-as-stream.js';

// --- Ingestion ------------------------------------------------------------
export { loadTextFile, loadTextDirectory } from './src/ingestion/loaders.js';
export {
  chunkByFixedSize,
  chunkBySeparators,
  chunkByTokens,
  chunkByHeadings,
  chunkByRecords,
  estimateTokens,
} from './src/ingestion/chunkers.js';

// --- Evaluación local (0.4.0) ----------------------------------------------
export {
  faithfulness,
  contextPrecision,
  contextRecall,
  answerRelevance,
  evaluateAnswer,
} from './src/evaluation/local-metrics.js';
export {
  loadGoldenSet,
  validateGoldenSet,
  runGoldenSet,
} from './src/evaluation/golden-runner.js';
export {
  buildRerankPrompt,
  RERANK_PROMPT_VERSION,
  RERANK_SNIPPET_MAX_CHARS,
} from './src/retrieval/rerank-prompt.js';

// --- Easy RAG (ADR-005) ---------------------------------------------------
export {
  detectSourceType,
  resolvePreset,
  classifySources,
  chunkWithPreset,
} from './src/easy/presets.js';
export {
  computeIndexFingerprint,
  hashContent,
  createEmptyManifest,
  diffManifest,
  loadManifest,
  saveManifest,
} from './src/easy/manifest.js';
export { collectIndexableFiles, indexDirectory } from './src/easy/indexer.js';
export { queryIndex } from './src/easy/query.js';
export { createRag } from './src/easy/sdk.js';
export { runDoctorChecks, runDoctorCommand } from './src/easy/doctor.js';
export {
  createRagService,
  openRagService,
  openEasyIndex,
  parseFingerprint,
} from './src/easy/rag-service.js';
export {
  runIndexCommand,
  runQueryCommand,
  runInitCommand,
  runServeCommand,
  runEvalCommand,
} from './src/easy/cli.js';
export { createRagHttpServer, startRagHttpServer } from './src/easy/http-server.js';
export { handleMcpMessage, startRagMcpServer } from './src/easy/mcp-server.js';
export {
  loadEasyConfig,
  saveEasyConfig,
  validateEasyConfig,
  DEFAULT_EASY_CONFIG,
} from './src/easy/config.js';

// --- Embedding ------------------------------------------------------------
export { createHashEmbedder } from './src/embedding/embedder.js';
export { createCachedEmbedder } from './src/embedding/embedding-cache.js';
export {
  createOpenAICompatibleEmbedder,
  createOllamaEmbedder,
} from './src/embedding/openai-compatible-embedder.js';
export { createTransformersEmbedder } from './src/embedding/transformers-embedder.js';

// --- Vector stores --------------------------------------------------------
export { InMemoryVectorStore } from './src/vector-store/in-memory-vector-store.js';
export { ensureIndexFingerprint } from './src/vector-store/fingerprint-guard.js';
export { migrateVectorStore } from './src/vector-store/migrate.js';
export { PgVectorStore } from './src/vector-store/pgvector-store.js';
export { LanceDBStore } from './src/vector-store/lancedb-store.js';

// --- Retrieval ------------------------------------------------------------
export { tokenize, BM25Index, createBM25Index } from './src/retrieval/bm25.js';
export { dedupeChunksByOverlap } from './src/retrieval/chunk-dedupe.js';
export { parallelRetrieve } from './src/retrieval/parallel-retrieve.js';
export { RetrieverRole } from './src/retrieval/retriever-role.js';
export { RerankerRole } from './src/retrieval/reranker-role.js';
export { SolomonRole } from './src/retrieval/solomon-role.js';

// --- Generation / Evaluation ---------------------------------------------
export { GeneratorRole, extractCitations } from './src/generation/generator-role.js';
export { EvaluatorRole } from './src/evaluation/evaluator-role.js';
export { evaluateMultiJudge, buildJudgePrompt } from './src/evaluation/multi-judge-evaluator.js';

// --- Policy / Redaction --------------------------------------------------
export {
  createDefaultSensitivityPolicy,
  validateSensitivityPolicy,
  resolveAdapterFor,
  isProviderAllowed,
} from './src/policy/sensitivity-policy.js';
export { redactPII } from './src/redaction/pii-redactor.js';
export { RedactionRole } from './src/redaction/redaction-role.js';

// --- Domain ---------------------------------------------------------------
export {
  SENSITIVITY_LEVELS,
  DEFAULT_SENSITIVITY,
  classifySensitivity,
  isSensitivityAllowed,
} from './src/domain/document.js';

// --- Registry / Config-driven --------------------------------------------
export { createDefaultRoleRegistry } from './src/registry/default-role-registry.js';
export { buildPipelineFromConfig } from './src/config/pipeline-builder.js';
export {
  validatePipelineConfig,
  loadPipelineConfig,
} from './src/config/pipeline-config.js';
