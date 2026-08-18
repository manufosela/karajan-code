---
title: 'Contrato con el motor'
description: 'Qué API de karajan-rag consume watch y qué gaps se han propuesto upstream: watch orquesta, nunca reimplementa mecánica de RAG.'
---

<!-- synced-from: manufosela/karajan-watch@v0.3.0:docs/karajan-rag-contract.md · section-sha256: d0d6ef99577b6df70e456e92973c2184f23c1dfc75063b1777d9063578e16995
     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->

Qué API de karajan-rag 1.2.x consume karajan-watch, y qué gaps se han
propuesto upstream. Regla de la familia: **lo genérico de RAG vive en el
motor** — watch orquesta, nunca reimplementa mecánica de RAG.

## API consumida

| Pieza | Uso en watch | Dónde |
| ----- | ------------ | ----- |
| CLI `karajan-rag index <ruta> --store --embedder` | Reindex incremental del workspace multi-repo en cada merge | `src/ingest.js`, workflow `ingest.yml` |
| `karajan.config.json` (sección `easy`: `store`, `embedder`, `sensitivity`, `sensitivityRules`) | Watch lo genera en la raíz del workspace para estampar la sensibilidad declarada por la capa de despliegue (nivel de corpus + regla por prefijo `repo/`) | `buildIngestPlan` |
| `SENSITIVITY_LEVELS`, `DEFAULT_SENSITIVITY` | Validación del config de despliegue: `public \| internal \| confidential`, default seguro `internal` | `src/config.js` |
| Manifest incremental (`.karajan/` del rootDir indexado) | Solo se reprocesa lo cambiado; ficheros ausentes se invalidan (de ahí la verificación de workspace completo) | `verifyWorkspace` |
| `queryIndex` (export ESM) | F2: cada chunk del diff mergeado como query contra el corpus `code`; los hits exponen `source` (path namespaceado `repo/…`) | pipeline de impacto (F2) |
| `karajan-rag serve [--mcp \| --http] --store` | Servir cada corpus a los agentes (MCP stdio o HTTP) | despliegue |
| Sensitivity policy (adapters permitidos por nivel) | F2/F3: el juicio LLM solo corre por adapters que la policy permita para el nivel efectivo del corpus | pipeline de impacto (F2) |
| Stores `lancedb \| pgvector \| in-memory`, embedders `hash \| transformers` | Valores válidos del esquema de configuración | `src/config.js` |

## Gaps upstream (propuestos en el Planning Game de Karajan RAG)

1. **Serve multi-corpus en un solo proceso** (KJR-PRP-0001). `serve` ata
   un proceso a un `rootDir` + store; `--http` y `--mcp` son excluyentes.
   Watch necesita servir `code` y `docs` a la vez.
   *Workaround actual:* un servicio por corpus.
2. **Filtro por prefijo/repo en query** (KJR-PRP-0002). `queryIndex` no
   acepta filtro de origen; para el impacto cross-repo hay que excluir el
   repo de origen del diff. *Workaround actual:* filtrado post-hoc sobre
   `hit.source` (paga retrieval de hits que se descartan y muerde el top-k).
3. **Tabla pgvector configurable por corpus** (KJR-PRP-0003). El CLI fija
   `karajan_rag_chunks`; `code` y `docs` no pueden compartir base de
   datos. *Workaround actual:* un `PG_URL` (base o schema) por corpus.

Si un gap se cierra upstream, el workaround correspondiente se retira de
watch en la misma versión que adopte el motor nuevo.
