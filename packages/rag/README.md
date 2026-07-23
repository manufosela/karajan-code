# Karajan RAG

[![CI](https://github.com/manufosela/karajan-rag/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/manufosela/karajan-rag/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/manufosela/karajan-rag?include_prereleases&sort=semver)](https://github.com/manufosela/karajan-rag/releases)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/karajan-rag.svg)](./package.json)
[![Status: experimental](https://img.shields.io/badge/status-experimental-orange.svg)](#)

> ⚠️ **Proyecto en fase de desarrollo temprano.** La API, la estructura de carpetas y el set de proveedores soportados pueden cambiar sin previo aviso. No apto para uso productivo todavía.

Orquestador multi-agente de CLIs de IA para construir pipelines **RAG** (Retrieval-Augmented Generation). Cada fase del pipeline (chunking, reranking, generación, evaluación…) puede delegarse al CLI/agente más idóneo o a código determinista, con adaptadores desacoplados por proveedor.

Es un proyecto **hermano** — y deliberadamente independiente — de [Karajan Code](https://github.com/manufosela/karajan-code), del que se toman prestados patrones (Role, AdapterRegistry) con atribución explícita.

## Proveedores

| Proveedor | Tipo | Estado |
|-----------|------|--------|
| Claude CLI   | público | ✅ integrado |
| Codex CLI    | público | ✅ integrado (streaming NDJSON) |
| Gemini CLI   | público | ✅ integrado |
| Ollama       | on-premise | 🔜 planificado (épica Data Sensitivity) |
| Azure OpenAI / AWS Bedrock / Vertex AI | nube privada | 🔜 planificado |

Los proveedores públicos quedan restringidos a datos con sensibilidad `public`. Los datos `internal` / `confidential` se enrutan a proveedores on-premise o nube privada con garantías de no-training.

## Arquitectura a alto nivel

```
┌──────────────────────────────────────────────────────────┐
│  Pipeline Engine (grafo de stages con I/O tipados JSDoc) │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────┐   ┌──────────────────────┐
│  Stage deterministas         │   │  Stage-Role          │
│  (loaders, chunker fixed,    │   │  (chunker semántico, │
│   embedder, vector store,    │   │   reranker, generator │
│   retriever)                 │   │   judge, …)          │
└──────────────────────────────┘   └──────────────────────┘
                                           │
                                           ▼
                             ┌──────────────────────────┐
                             │  AdapterRegistry (DI)    │
                             │  claude / codex / gemini │
                             │  ollama / azure / …      │
                             └──────────────────────────┘
```

Fases típicas del pipeline RAG:

- **Indexing** (offline): ingestión → chunking → embedding → vector store.
- **Query** (online): retrieval → reranking → generation → evaluation.

Ver la documentación de cada épica en el Planning Game interno para el detalle.

## Requisitos

- Node.js **18+** (recomendado 20 o 22 LTS).
- [pnpm](https://pnpm.io) como package manager.
- (Opcional) CLIs de proveedor instalados localmente: `claude`, `codex`, `gemini`, `ollama`.

## Comandos

```bash
pnpm install

pnpm test               # unit tests (node:test)
pnpm coverage           # tests + reporte de coverage (c8)
pnpm lint               # ESLint flat config
pnpm start              # demo multi-CLI contra los 3 proveedores

# Smoke tests por proveedor — opt-in, requieren CLI instalado.
# No se ejecutan con `pnpm test` ni en CI. Vía pnpm ya se exporta RUN_SMOKE=1.
pnpm smoke:claude
pnpm smoke:codex
pnpm smoke:gemini
pnpm smoke:ollama
```

## RAG en 5 minutos (Easy RAG)

Crear un RAG sobre una carpeta de código, docs o datos sin escribir código
([ADR-005](./docs/adrs/ADR-005-easy-rag-layer.md)):

```bash
karajan-rag index ./mi-proyecto                    # autodetecta e indexa (LanceDB local)
karajan-rag query "¿cómo se factura?" ./mi-proyecto # híbrido vector+BM25, fichero:línea
karajan-rag serve ./mi-proyecto                     # servidor MCP (rag_query/rag_status)
karajan-rag serve ./mi-proyecto --http --port 8080  # o HTTP: POST /query, GET /health
```

Reindexado incremental, config opcional (`karajan-rag init`), imagen Docker
y despliegue en GCP con Terraform (`deploy/gcp/`). Guía completa:
[docs/easy-rag.md](./docs/easy-rag.md).

## Quickstart end-to-end

Ejemplo mínimo que encadena todo el stack RAG con stubs locales — sin Ollama,
sin pgvector, sin CLIs reales:

```bash
pnpm install
node examples/run-demo.js
```

El script:
1. Carga el corpus de `examples/sample-corpus/` (3 .md).
2. Los trocea con `chunkBySeparators`.
3. Los embebe con `HashEmbedder` (determinista, stub).
4. Los indexa en `InMemoryVectorStore`.
5. Ejecuta `RetrieverRole` → `GeneratorRole` con un adapter fake.
6. Imprime la respuesta + las citas extraídas.

Para usar un pipeline declarativo:

```bash
# Los roles built-in se registran vía createDefaultRoleRegistry.
# Ver examples/pipeline.json para el formato JSON.
```

Para pasar a real:
- Reemplaza `createHashEmbedder` por `createOllamaEmbedder()` (requiere Ollama local).
- Reemplaza `InMemoryVectorStore` por un backend persistente (LanceDB, pgvector).
- Reemplaza `fakeClaudeAdapter` por `runClaudeCli` del `createDefaultAdapterRegistry()`.

## API pública

Todos los símbolos soportados se re-exportan desde el `package main`:

```js
import {
  // Pipeline
  runPipeline, createPipelineContext, Role, RoleRegistry, estimateSize,
  // Adapters
  AdapterRegistry, createDefaultAdapterRegistry,
  runClaudeCli, runCodexCli, runGeminiCli, runOllamaCli,
  runAzureOpenAi, runBedrock, runVertexAi,
  createOllamaStreamAdapter,
  // Ingestion
  loadTextFile, loadTextDirectory,
  chunkByFixedSize, chunkBySeparators, chunkByTokens, chunkByHeadings,
  // Embedding
  createHashEmbedder, createCachedEmbedder,
  createOllamaEmbedder, createOpenAICompatibleEmbedder,
  createTransformersEmbedder,
  // Vector stores
  InMemoryVectorStore, PgVectorStore, LanceDBStore,
  // Retrieval
  BM25Index, createBM25Index, dedupeChunksByOverlap, parallelRetrieve,
  RetrieverRole, RerankerRole, SolomonRole,
  // Generation / Evaluation
  GeneratorRole, extractCitations, EvaluatorRole, evaluateMultiJudge,
  // Policy / Redaction
  createDefaultSensitivityPolicy, isProviderAllowed,
  redactPII, RedactionRole,
  // Config-driven
  createDefaultRoleRegistry, buildPipelineFromConfig, loadPipelineConfig,
} from 'karajan-rag';
```

Ejemplo mínimo — pipeline de 2 stages (retriever + generator) con un adapter fake:

```js
import {
  runPipeline, createPipelineContext,
  RetrieverRole, GeneratorRole,
  InMemoryVectorStore, createHashEmbedder,
} from 'karajan-rag';

const embedder = createHashEmbedder({ dimensions: 64 });
const store = new InMemoryVectorStore({ dimensions: 64 });

// (Supón que `store` ya tiene documentos indexados…)

const retriever = new RetrieverRole({
  name: 'retriever', logger: console,
  embedder, store, topK: 3,
});
const generator = new GeneratorRole({
  name: 'generator', logger: console,
  adapter: async () => ({
    provider: 'fake',
    parsedOutput: { format: 'text', text: 'respuesta' },
    process: { exitCode: 0, stderr: '' },
    providerMeta: {},
  }),
});

const ctx = createPipelineContext({
  logger: console,
  tools: { get: () => { throw new Error('n/a'); }, has: () => false },
});

const result = await runPipeline(
  [
    { name: 'retrieve', run: (q, c) => retriever.run({ query: q }, c.tools) },
    { name: 'generate', run: (hits, c) => generator.run({ query: 'q', contextChunks: hits.hits }, c.tools) },
  ],
  'mi pregunta',
  ctx,
);

console.log(result.output.answer);
```

Ejemplos ejecutables end-to-end en [`examples/`](./examples/):

| Ejemplo | Demuestra |
|---------|-----------|
| `run-demo.js` | Pipeline RAG básico con corpus local + stubs. |
| `multi-cli-demo.js` | Orquestación multi-CLI (Claude + Codex + Gemini). Requiere CLIs instalados. |
| `observability-demo.js` | Hooks `onStageStart/End/Error` con `console.table`. |
| `solomon-multi-source.js` | `parallelRetrieve` + `SolomonRole weighted` + `streamGenerate` end-to-end sin credenciales. |

## Estructura

```
src/
  ai/
    adapters/
      claude-cli-adapter.js
      codex-cli-adapter.js
      gemini-cli-adapter.js
    cli-runner.js
    output-parser.js
    multi-cli-orchestrator.js
scripts/
  smoke.js
tests/
  output-parser.test.js
index.js
```

## Estabilidad y roadmap

**Desde la 1.0.0 la API pública es estable**: semver estricto, [política
de deprecación](./docs/DEPRECATION.md) con 2 minors de preaviso y test de
contrato de la superficie exportada. Los criterios de salida de la serie
0.x —incluida una [revisión independiente de la política de sensibilidad
y el redactor PII](./docs/security/sensitivity-audit.md#6-revisiones-realizadas)
y un [caso de uso real desplegado en GCP](./docs/case-study-gcp.md)—
están documentados en [ROADMAP.md](./ROADMAP.md).

El backlog táctico (`KJR-TSK-XXXX`) vive en Planning Game privado.

## Licencia

[AGPL-3.0-or-later](LICENSE). Coherencia con Karajan Code; si tu caso de uso requiere una licencia más permisiva, abre un issue para discutirlo.

## Architecture Decision Records

- [ADR-001 — Karajan-style patterns en Karajan RAG (copy + attribution)](docs/adrs/ADR-001-kjc-reuse-strategy.md)
- [ADR-002 — Reindex policy ante cambios de embedder o dimensión](docs/adrs/ADR-002-reindex-policy.md)
- [ADR-003 — Solomon: slot arquitectónico multi-source](docs/adrs/ADR-003-solomon-slot.md) _(superseded by ADR-004)_
- [ADR-004 — Solomon: implementación real de estrategias de arbitraje](docs/adrs/ADR-004-solomon-implementation.md)

## Planificación

La gestión de tareas, épicas y ADRs de este proyecto se lleva en una instancia privada de **Planning Game** (XP). Si colaboras, pide acceso.
