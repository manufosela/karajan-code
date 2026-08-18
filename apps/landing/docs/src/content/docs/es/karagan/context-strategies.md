---
title: 'El motor de estrategias de contexto'
description: 'rag, cag e hybrid sobre el mismo índice, y eval --compare-modes para decidir con datos qué contexto viaja al modelo.'
---

<!-- synced-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · section-sha256: 196b3ea9c227741fdd59b52e132390f705c13a3962c3166ce45370f5431d4b2b
     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->

La decisión central de cualquier RAG es **qué contexto viaja al modelo**.
karajan-rag no la impone: sobre el mismo índice ofrece tres estrategias
(`--mode rag|cag|hybrid`), todas por el mismo camino guardado (sensitivity
policy + redacción PII). `rag` es el default que ya has visto: los top-k
chunks del retrieval híbrido.

## Modo CAG: el corpus completo como contexto

Para corpus pequeños/medianos, `--mode cag` (Cache-Augmented Generation)
salta el retrieval y carga **todo el corpus** en el contexto del modelo:

```bash
karajan-rag query "resume la arquitectura" ./mi-proyecto --answer --mode cag
```

- El contexto es **determinista y estable** (orden por ruta): mismo
  corpus → mismo prompt, lo que permite al proveedor amortizar su
  prompt-cache entre consultas.
- La sensibilidad efectiva es el **máximo de todo el manifest** — aquí
  viaja el corpus entero, así que el gate es más restrictivo que en RAG
  por diseño. La redacción PII aplica igual.
- Presupuesto con fallo explícito (`--max-context-chars`, default
  400K caracteres ≈ 100K tokens): si el corpus no cabe, error con el
  tamaño real y alternativas — **nunca se trunca en silencio**.
- No necesita vector store para responder (el manifest basta), pero sí
  un corpus indexado.

Y el término medio, `--mode hybrid`: el retrieval **selecciona** los
ficheros relevantes y el contexto lleva esos ficheros **completos** (no
fragmentos), con los que no caben en el presupuesto declarados en el
log. Ideal cuando los chunks se quedan cortos pero el corpus entero no
cabe.

Regla rápida: corpus que cabe en contexto y preguntas que piden visión
global → `cag`; corpus grande y preguntas puntuales → `rag`; corpus
grande y preguntas que piden entender ficheros enteros → `hybrid`.
¿Dudas con TU corpus? Decide con datos:

```bash
karajan-rag eval golden.json --compare-modes
```

Compara offline el recall del retrieval contra el coste de contexto de
cada modo y emite una recomendación justificada con números.
