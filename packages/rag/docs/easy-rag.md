# RAG en 5 minutos (Easy RAG)

Guía end-to-end de la capa Easy RAG ([ADR-005](./adrs/ADR-005-easy-rag-layer.md)):
crear un RAG consultable sobre una base de código, documentos o datos sin
escribir una línea de código. Todo funciona offline y sin credenciales.

## Requisitos

```bash
npm install -g karajan-rag      # o npx karajan-rag <comando>
pnpm add @lancedb/lancedb       # store local por defecto (peer opcional)
```

## 1. Indexar

```bash
karajan-rag index ./mi-proyecto
```

Qué pasa:

- Autodetección por tipo de fichero: **código** (js/ts/py/go/…) se trocea
  respetando límites de declaración, **docs** (md/txt/rst) por headings,
  **datos** (csv/tsv/jsonl) por lotes de registros con la cabecera como
  contexto. Binarios y extensiones desconocidas quedan excluidos y
  listados — nunca ignorados en silencio.
- El índice persiste en `./mi-proyecto/.karajan/` (gitignóralo — `init` lo
  hace por ti) con un `manifest.json` que guarda el fingerprint del espacio
  vectorial (ADR-002) y el hash de cada fichero.
- **Reindexado incremental**: vuelve a lanzar el mismo comando y solo se
  reprocesa lo que cambió; los ficheros borrados se invalidan del store.

> El embedder por defecto es `hash`: determinista y sin dependencias, ideal
> para probar el flujo. Para calidad semántica real usa
> `--embedder transformers` (requiere `@huggingface/transformers`).

## 2. Consultar

```bash
karajan-rag query "¿cómo se calcula la facturación?" ./mi-proyecto
```

Retrieval híbrido (vector + BM25 con dedupe) con salida `fichero:línea (score)`
y el pasaje. El embedder se autoconfigura desde el manifest: es imposible
consultar con un espacio vectorial distinto al indexado.

Con un CLI de IA instalado (claude/codex/gemini/ollama…), añade generación:

```bash
karajan-rag query "¿cómo se calcula la facturación?" ./mi-proyecto --answer --adapter ollama
```

## 3. Servir

### Como servidor MCP (para Claude Code y otros agentes)

```bash
claude mcp add mi-rag -- karajan-rag serve /ruta/a/mi-proyecto
```

Expone las tools `rag_query` y `rag_status` por stdio (JSON-RPC 2.0).

### Como HTTP API

```bash
karajan-rag serve ./mi-proyecto --http --port 8080
curl -s localhost:8080/health
curl -s -X POST localhost:8080/query -H 'content-type: application/json' \
  -d '{"question": "facturación", "topK": 3}'
```

## 4. Personalizar (opcional)

```bash
karajan-rag init ./mi-proyecto        # wizard → karajan.config.json
karajan-rag init ./mi-proyecto --yes  # no interactivo (CI)
```

La config actúa como defaults del proyecto (store, embedder, dimensions,
topK, adapter); los flags de CLI siempre ganan. Config inválida → error
explícito con la clave exacta.

## 5. En contenedor

```bash
docker build -t karajan-rag-server .
docker run --rm -v $PWD/mi-proyecto:/data --entrypoint node \
  karajan-rag-server bin/karajan-rag.js index /data
docker run -d -p 8080:8080 -v $PWD/mi-proyecto:/data karajan-rag-server
```

`docker compose up` levanta además Postgres+pgvector para el modo
`KARAJAN_STORE=pgvector` (ver `docker-compose.yml`).

## 6. En Google Cloud

```bash
cd deploy/gcp
terraform apply -var project_id=MI_PROYECTO
```

Cloud Run + Cloud SQL pgvector + GCS + Secret Manager, privado por defecto.
Flujo completo (imagen, migración, indexado, rsync del índice, query con
identity token) en [`deploy/gcp/README.md`](../deploy/gcp/README.md).

## Garantías transversales

- **Sensitivity first**: el routing por sensibilidad y el redactor PII del
  paquete siguen activos en todos los presets; easy-mode puede endurecerlos,
  nunca relajarlos.
- **Sin fallbacks silenciosos**: peer ausente, config inválida, índice
  inexistente o fingerprint incompatible → error con el paso exacto para
  arreglarlo.
- **Determinismo por defecto**: todo el flujo local funciona sin
  credenciales ni red.
