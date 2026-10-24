# El RAG del repo fusiona por RRF, antepone metadatos al texto embebido y reordena de serie con un cross-encoder local

Status: accepted
Date: 2026-10-24
Accepted: 2026-10-24, by the maintainer; the reranker model is chosen by the RAG-E baseline numbers (MRR and p95 latency), MiniLM as the floor

## Context

Épica KJC-PCS-0102, propuesta del usuario (24-oct) para la 5.0.0. Hoy el modo híbrido suma puntuaciones normalizadas de BM25 y coseno con alpha=0.6, se embebe solo el cuerpo del trozo (sin ruta, símbolo ni padre), el re-ranker es opcional (rag.search.rerank) con Xenova/ms-marco-MiniLM-L-6-v2, y kj rag eval mide recall@k y MRR sin latencia ni línea base congelada. Una consulta por nombre de módulo o clase no encuentra trozos cuyo cuerpo no lo menciona, y el alpha depende de la escala de cada puntuación.

## Decision

Tres decisiones, medidas contra la línea base de RAG-E antes de cada una. (1) Fusión por Reciprocal Rank Fusion: cada candidato suma 1/(k+rango) por lista, k=60 y configurable (rag.search.rrf_k); alpha desaparece y kj avisa si sigue en la config. (2) Cabecera de metadatos (ruta, lenguaje, símbolo, símbolo padre, rango de líneas) antepuesta al texto que se envía al embedder y guardada en columnas; el texto devuelto al agente no la lleva; migración de esquema con reindexado automático y avisado. (3) Re-ranker de serie cuando el modelo está en local: reordena el top 40 y devuelve el top 8, ambos configurables, desactivable; sin modelo degrada a la recuperación híbrida avisando una vez. Modelo: queda a decisión del usuario entre mantener ms-marco-MiniLM-L-6-v2 (90 MB, ya vendido, ~80 ms por 5 trozos) o pasar a bge-reranker-v2-m3 (~1,1 GB, multilingüe y mejor en código, más lento en CPU); la recomendación es medir los dos con RAG-E y elegir por MRR y latencia p95, con MiniLM como suelo. Alternativas: seguir con la suma ponderada y ajustar alpha por repo (descartada: no hay dato para ajustarlo y cambia con el corpus); como si el código no existiera, un solo modelo de embeddings de código con re-ranker por LLM (descartado: coste por consulta y no es local).

## Medición (2026-10-24, KJC-TSK-1172 y KJC-TSK-1181)

Corpus fijo de RAG-E (10 ficheros, 34 trozos, 24 consultas, nomic-embed-text). (1) RRF frente a la suma con alpha: recall@5 0,958 → 1,0, MRR 0,896 → 0,925, p95 36 → 37 ms; la línea base se recongeló con esos números. (3) Re-ranker ms-marco-MiniLM-L-6-v2 ya cargado, sobre esa misma fusión: MRR 0,925 con y sin él (top 20 y top 40), p95 43 ms sin él frente a 80 ms (top 20) y 64 ms (top 40). Con recall@5 en 1,0 el re-ranker no tenía nada que ascender y solo costó latencia. Ajuste propuesto de la decisión 3: el re-ranker queda disponible (`rag.search.rerank.enabled`, `top_n`, `model`, y `--rerank` en query y eval) pero desactivado de serie hasta que un corpus mayor muestre mejora; la degradación avisada se mantiene. bge-reranker-v2-m3 no se ha medido: sin margen de MRR que ganar en este corpus, descargar 1,1 GB no aportaba dato. Confirmado por el mantenedor el 2026-10-24: el re-ranker queda desactivado de serie.

## Consequences

La calidad de recuperación pasa a tener números: recall@k, MRR y latencia en tests/rag/baseline.json, y un test falla si empeoran. El índice se reindexa una vez por la migración de esquema. El re-ranker de serie suma latencia por consulta (el margen lo fija RAG-E) y, si se elige bge, una descarga de ~1,1 GB en el primer uso. La fusión y el re-ranker viven en packages/core/src/rag: cada cambio es PR en core, publicar core y después la PR de kj.
