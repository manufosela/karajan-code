---
title: 'RAG en 5 minutos'
description: 'Indexa y consulta una base de código, documentos o datos sin escribir una línea de código. Offline y sin credenciales.'
---

<!-- synced-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · section-sha256: 3d7d490d5a1f787df0f83628b68c4488c9f11a617902fca4b2a94d592c2abf3a
     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->

Guía end-to-end de la capa Easy RAG ([ADR-005](https://github.com/manufosela/karajan-rag/blob/v1.5.0/docs/adrs/ADR-005-easy-rag-layer.md)):
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
