---
title: 'Servir y personalizar'
description: 'Servidor MCP para agentes, HTTP API con playground web y karajan.config.json como defaults del proyecto.'
---

<!-- synced-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · section-sha256: 8c3fe4e889c4383c9fc1eb4a314855c118bb7af3bf883f60344e0937d1315d9c
     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->

#### Como servidor MCP (para Claude Code y otros agentes)

```bash
claude mcp add mi-rag -- karajan-rag serve /ruta/a/mi-proyecto
```

Expone las tools `rag_query` y `rag_status` por stdio (JSON-RPC 2.0).

#### Como HTTP API (con playground web)

```bash
karajan-rag serve ./mi-proyecto --http --port 8080
## abre http://localhost:8080/ → playground: pregunta, modo (rag/cag/hybrid)
## y las garantías siempre visibles (adapter usado y nivel del gate)
curl -s localhost:8080/health
curl -s -X POST localhost:8080/query -H 'content-type: application/json' \
  -d '{"question": "facturación", "topK": 3}'
curl -s -X POST localhost:8080/answer -H 'content-type: application/json' \
  -d '{"question": "resume la arquitectura", "mode": "cag"}'
```

La página es autocontenida (cero assets externos — funciona en
despliegues sin salida a internet) y `--no-ui` la apaga para servir solo
la API. Los defaults de `/answer` (adapter, topK) salen de
`karajan.config.json`, igual que en el CLI; por red nunca viaja el
inventario de rutas del corpus (solo conteos). La autenticación es de la
capa de despliegue (IAM/invoker en GCP).

### 4. Personalizar (opcional)

```bash
karajan-rag init ./mi-proyecto        # wizard → karajan.config.json
karajan-rag init ./mi-proyecto --yes  # no interactivo (CI)
```

La config actúa como defaults del proyecto (store, embedder, dimensions,
topK, adapter, sensitivity); los flags de CLI siempre ganan. Config
inválida → error explícito con la clave exacta.
