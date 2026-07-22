// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../index.js';

const REQUIRED_EXPORTS = [
  // Pipeline
  'runPipeline',
  'createPipelineContext',
  'estimateSize',
  'Role',
  'RoleRegistry',
  'ROLE_EVENTS',
  'collectPipelineEvents',

  // Adapters
  'AdapterRegistry',
  'createDefaultAdapterRegistry',
  'runMultiCli',
  'runClaudeCli',
  'runCodexCli',
  'runGeminiCli',
  'runOllamaCli',
  'runAzureOpenAi',
  'runBedrock',
  'runVertexAi',
  'createOllamaStreamAdapter',
  'readNdjsonLines',
  'wrapAdapterAsStream',

  // Ingestion
  'loadTextFile',
  'loadTextDirectory',
  'chunkByFixedSize',
  'chunkBySeparators',
  'chunkByTokens',
  'chunkByHeadings',
  'chunkByRecords',
  'estimateTokens',

  // Evaluación local (0.4.0)
  'faithfulness',
  'contextPrecision',
  'contextRecall',
  'answerRelevance',
  'evaluateAnswer',
  'loadGoldenSet',
  'validateGoldenSet',
  'runGoldenSet',
  'buildRerankPrompt',
  'RERANK_PROMPT_VERSION',
  'RERANK_SNIPPET_MAX_CHARS',

  // Easy RAG (ADR-005)
  'detectSourceType',
  'resolvePreset',
  'classifySources',
  'chunkWithPreset',
  'computeIndexFingerprint',
  'hashContent',
  'createEmptyManifest',
  'diffManifest',
  'loadManifest',
  'saveManifest',
  'collectIndexableFiles',
  'indexDirectory',
  'runIndexCommand',
  'queryIndex',
  'runQueryCommand',
  'createRagService',
  'openRagService',
  'openEasyIndex',
  'parseFingerprint',
  'runInitCommand',
  'runServeCommand',
  'runEvalCommand',
  'ensureIndexFingerprint',
  'createRagHttpServer',
  'startRagHttpServer',
  'handleMcpMessage',
  'startRagMcpServer',
  'loadEasyConfig',
  'saveEasyConfig',
  'validateEasyConfig',
  'DEFAULT_EASY_CONFIG',

  // Embedding
  'createHashEmbedder',
  'createCachedEmbedder',
  'createOpenAICompatibleEmbedder',
  'createOllamaEmbedder',
  'createTransformersEmbedder',

  // Vector stores
  'InMemoryVectorStore',
  'PgVectorStore',
  'LanceDBStore',

  // Retrieval
  'tokenize',
  'BM25Index',
  'createBM25Index',
  'dedupeChunksByOverlap',
  'parallelRetrieve',
  'RetrieverRole',
  'RerankerRole',
  'SolomonRole',

  // Generation / Evaluation
  'GeneratorRole',
  'extractCitations',
  'EvaluatorRole',
  'evaluateMultiJudge',

  // Policy / Redaction
  'createDefaultSensitivityPolicy',
  'validateSensitivityPolicy',
  'redactPII',
  'RedactionRole',
  'isProviderAllowed',

  // Domain
  'SENSITIVITY_LEVELS',
  'DEFAULT_SENSITIVITY',
  'classifySensitivity',
  'isSensitivityAllowed',

  // Config-driven
  'createDefaultRoleRegistry',
  'buildPipelineFromConfig',
  'validatePipelineConfig',
  'loadPipelineConfig',
];

test('public API: expone todos los símbolos esperados', () => {
  const missing = REQUIRED_EXPORTS.filter((name) => !(name in api));
  assert.deepEqual(missing, [], `Símbolos ausentes: ${missing.join(', ')}`);
});

test('public API: el barrel no tiene side effects (importar no ejecuta demos)', async () => {
  // Si index.js ejecutase main() al cargarse, este test no podría terminar
  // sin tocar la red/procesos spawn. El hecho de que se complete aquí ya es
  // un assert implícito; dejamos además un chequeo de que el módulo no
  // tiene un `default` que dispare nada.
  assert.equal('default' in api, false);
});

test('public API: runPipeline es invocable', async () => {
  const ctx = api.createPipelineContext({
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    tools: { get: () => { throw new Error('n/a'); }, has: () => false },
  });
  const res = await api.runPipeline(
    [{ name: 'identity', run: (x) => x }],
    'ok',
    ctx,
  );
  assert.equal(res.ok, true);
  assert.equal(res.output, 'ok');
});

test('public API: SolomonRole se instancia desde el barrel', () => {
  const s = new api.SolomonRole({
    name: 's',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  assert.equal(s.name, 's');
});
