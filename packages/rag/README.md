# Karajan RAG

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

## Roadmap (Sprint 1)

- Pipeline Engine & Role System.
- AdapterRegistry inyectable.
- CI GitHub Actions (matriz Node 20 / 22).
- Mining selectivo de Karajan Code con ADR de reuso.
- Adapter Ollama + metadata `sensitivity` en Document/Chunk.

Épicas futuras: loaders + chunking, embeddings + vector store, retrieval + reranking, generation + evaluation, config-driven runs, policy engine por sensibilidad.

## Licencia

[AGPL-3.0-or-later](LICENSE). Coherencia con Karajan Code; si tu caso de uso requiere una licencia más permisiva, abre un issue para discutirlo.

## Architecture Decision Records

- [ADR-001 — Reutilización de Karajan Code vía copy + attribution](docs/adrs/ADR-001-kjc-reuse-strategy.md)

## Planificación

La gestión de tareas, épicas y ADRs de este proyecto se lleva en una instancia privada de **Planning Game** (XP). Si colaboras, pide acceso.
