# ADR-005 — Capa Easy RAG: comandos, configuración y layout del índice local

- **Status**: accepted
- **Date**: 2026-07-22
- **Deciders**: equipo KJR
- **Related tasks**: KJR-TSK-0100 (este ADR), KJR-TSK-0101…0108 (implementación, épica KJR-PCS-0016)
- **Related**: [ADR-002](./ADR-002-reindex-policy.md) (política de reindex por fingerprint)

## Context

karajan-rag tiene toda la maquinaria de un RAG (ingestion, chunking, embedding,
vector stores, retrieval híbrido, generación, evaluación, policy de sensibilidad
y redacción PII), pero montar un RAG hoy exige escribir una config de pipeline o
código contra la API. La épica **Easy RAG** añade una capa de experiencia para
que crear un RAG sobre una base de código, documentos o datos cueste minutos y
cero código, incluyendo servirlo (MCP/HTTP) y desplegarlo en cloud (Terraform).

Este ADR fija las decisiones transversales que el resto de la épica necesita:
superficie de comandos, formato de configuración, layout del índice persistente
y defaults.

## Decision

### 1. Superficie de comandos

El binario `karajan-rag` conserva `run <config.json>` (pipelines declarativos,
sin cambios) y añade cuatro subcomandos:

| Comando | Qué hace |
|---------|----------|
| `init` | Wizard/scaffold que genera `karajan.config.json` con defaults comentados. `--yes` para modo no interactivo. No sobreescribe sin `--force`. |
| `index <ruta>` | Autodetecta tipo de fuente (código / docs / datos), aplica el preset correspondiente y construye/actualiza el índice persistente local. |
| `query "<pregunta>"` | Retrieval híbrido contra el índice (`--answer` añade generación con el adapter configurado, streaming si lo soporta). |
| `serve` | Expone el índice como servidor MCP (`--mcp`, default) y/o HTTP (`--http`). |

Los subcomandos easy-mode **no** sustituyen a `run`: son azúcar sobre las mismas
piezas (`buildPipelineFromConfig`, roles y stores existentes). Todo lo que hace
easy-mode puede reproducirse con una config explícita.

### 2. Configuración: `karajan.config.json` en la raíz del proyecto

- Un único fichero JSON (validado con el schema de config-driven runs, que se
  amplía con la sección `easy`) en la raíz del directorio indexado.
- `init` lo genera; `index`/`query`/`serve` lo leen si existe y funcionan sin él
  aplicando defaults (config opcional, nunca obligatoria).
- La configuración explícita del usuario **siempre** gana sobre la
  autodetección. Sin fallbacks silenciosos: si la config declara un recurso no
  disponible (p. ej. store `pgvector` sin `PG_URL`), el comando falla con
  mensaje accionable.

### 3. Layout del índice: directorio `.karajan/` junto a la fuente

```
<proyecto indexado>/
├── karajan.config.json      # opcional, generado por init
└── .karajan/                # gitignored (init lo añade a .gitignore)
    ├── manifest.json        # fingerprint + estado incremental
    └── index/               # datos del vector store (LanceDB u otro)
```

- `manifest.json` implementa la política de [ADR-002](./ADR-002-reindex-policy.md):
  fingerprint `model|dimensions|chunkSize` a nivel de índice + hash de contenido
  por fichero para reindex incremental (solo se reprocesa lo que cambió; los
  ficheros borrados se invalidan del store).
- Si el fingerprint global cambia (otro embedder, otras dimensiones, otro
  chunking), el índice se reconstruye entero — nunca se mezclan espacios
  vectoriales.
- El índice vive junto a la fuente (no en `~/.karajan-rag`) para que borrar el
  proyecto borre su índice y para que dos checkouts no compartan estado.

### 4. Defaults deterministas, calidad opt-in

| Pieza | Default | Alternativas (opt-in) |
|-------|---------|----------------------|
| Vector store | `LanceDBStore` (local, sin credenciales) | `pgvector` (`--store pgvector` + `PG_URL`), `in-memory` (efímero, para pruebas) |
| Embedder | `HashEmbedder` (determinista, cero dependencias) | `transformers` (peer-dep transformers.js), `openai-compatible` |
| Generación | Ninguna (query devuelve pasajes) | `--answer` con el adapter configurado (claude/codex/gemini/ollama/azure/bedrock/vertex) |

- LanceDB es peer-dep opcional: si no está instalada, `index` falla con el
  mensaje exacto de instalación (`pnpm add @lancedb/lancedb`) — **no** hay
  fallback silencioso a memoria.
- `HashEmbedder` como default mantiene el principio "determinismo por defecto"
  (funciona offline, resultados reproducibles). `index` emite un aviso claro de
  que para calidad semántica real debe activarse `transformers` u
  `openai-compatible`. Elegir calidad es decisión explícita del usuario, no
  humo del framework.

### 5. Presets por tipo de fuente

La autodetección clasifica cada fichero en uno de tres grupos y aplica su
preset (chunker + metadatos). Una carpeta mixta usa varios presets a la vez y
el manifest registra qué preset procesó cada fichero.

| Tipo | Detección | Chunking |
|------|-----------|----------|
| Código | Extensiones de lenguaje (js/ts/py/go/…) | Chunker de código existente (respetando límites de función/clase) |
| Docs | md/mdx/txt/rst | Chunker por headings/párrafos |
| Datos | csv/tsv/json/jsonl | Chunker por registro/lote con cabeceras como contexto |

Los binarios y ficheros ignorados por `.gitignore` se excluyen siempre.

### 6. Sensibilidad y PII no son opcionales

Los presets pasan **siempre** por el routing de sensibilidad y el redactor PII
existentes, con la política por defecto del paquete. Easy-mode puede endurecer
la política vía config, nunca relajarla por debajo del default. Ninguna feature
de esta épica puede degradar este comportamiento (principio nº 1 del roadmap).

### 7. `serve` y despliegue comparten la misma API

`serve` expone dos tools MCP (`rag_query`, `rag_status`) y, en modo HTTP,
`POST /query` + `GET /health`. La imagen Docker (KJR-TSK-0106) y el módulo
Terraform `deploy/gcp/` (KJR-TSK-0107: Cloud Run + Cloud SQL pgvector + GCS +
Secret Manager) empaquetan exactamente este servidor con store `pgvector` — el
contrato de la API es el mismo en local y en cloud, y `deploy/` queda preparado
para módulos hermanos (`aws/`, `azure/`).

## Consequences

- Un usuario nuevo llega a un RAG consultable con `index` + `query` sin
  escribir configuración; la curva de personalización es gradual (config →
  pipelines `run` → API).
- Adelantamos parte de 0.4.0: el manifest incremental de ADR-002 se implementa
  aquí (KJR-TSK-0102) y 0.4.0 hereda esa base para migraciones entre stores.
- Nueva superficie CLI que mantener y testear (unit por subcomando + smoke
  end-to-end en KJR-TSK-0108).
- `.karajan/` introduce estado local en repos de usuarios: `init` debe
  gitignorarlo y la docs debe explicarlo.
- La decisión "LanceDB requerida para easy-mode" añade un paso de instalación
  al quickstart a cambio de no mantener otro store persistente propio.
