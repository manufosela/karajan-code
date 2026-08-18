# ADR-002 — Reindex policy ante cambios de embedder o dimensión

- **Status**: proposed
- **Date**: 2026-04-19
- **Deciders**: equipo KJR
- **Related tasks**: KJR-TSK-0054 (este ADR), KJR-TSK-0049 (Embedders), KJR-TSK-0050 (PgVectorStore), KJR-TSK-0052 (EmbeddingCache)
- **PG ADR ID**: `-OqbSRdhZi-BFZVGtN2U`

## Context

El **Embedder** usado en la fase de ingesta determina la **dimensión** y la **semántica** de los vectores almacenados. Cambiar de modelo o de dimensión **invalida** los vectores previos:

- Queries embebidas con un modelo nuevo ya no son comparables (por álgebra o por semántica) con vectores embebidos con el modelo viejo.
- Si además cambia la dimensión, la `similarity` es directamente inválida (pgvector/LanceDB fallarían o devolverían basura).
- El `EmbeddingCache` (KJR-TSK-0052) agrava el problema si su key no incluye modelo/dimensión: puede devolver un vector viejo para un texto ya visto.

Sin política escrita, cualquier cambio de embedder puede producir retrievals silenciosamente degradados sin señal clara al mantenedor.

## Decision

**La configuración del embedder (model, dimensions, provider) es parte del _fingerprint_ del índice y del cache. Cambios se detectan al abrir, y requieren reindex explícito.**

### Reglas

1. **Fingerprint obligatorio por store**: cada `VectorStore` persistente (LanceDB, pgvector) almacena al crearse un fingerprint:
   ```json
   { "embedderModel": "nomic-embed-text",
     "embedderDimensions": 768,
     "embedderProvider": "ollama" }
   ```
   Al abrir una store existente, se compara el fingerprint actual con el configurado. **Mismatch lanza error con instrucciones de reindexado** (no se permite operar en estado inconsistente).

2. **Cache key incluye modelo y dimensión**: la key del `EmbeddingCache` es `sha256(model|dimensions|text)`. Así, cambiar de modelo no invalida manualmente el cache: simplemente miss y se recalcula.

3. **Política de reindex**:

   | Cambio | Política |
   |--------|----------|
   | Dimensión distinta | **Reindex completo obligatorio** (incompatible por álgebra) |
   | Mismo provider + modelo + dimensión | No-op |
   | Mismo provider, distinto modelo, misma dim | **Reindex recomendado**; se permite opt-out por config (`allowSameDimDifferentModel: true`) con warning |
   | Añadir chunks nuevos con mismo embedder | **Incremental** (upsert normal) |

4. **Implementación diferida**: este ADR documenta la política. La detección automática (fingerprint + compare) y el comando `karajan-rag reindex` se implementan **cuando se produzca el primer cambio real de modelo**. No merece la pena escribir el comando antes de tener un caso real.

5. **Mientras tanto**: incluir en el README del módulo pgvector/LanceDB una **nota explícita** explicando que cambiar embedder requiere hoy `DROP TABLE` (o borrar el directorio `.lance`) y reingestar todo. Esta nota queda como recordatorio permanente hasta que se active el fingerprint check.

## Consequences

### Positivas

- Detección temprana de desalineación entre índice y embedder activo.
- El cache no sirve hits erróneos tras cambio de modelo.
- Queda política escrita para no discutirla ad-hoc cada vez que cambia una configuración.
- La migración futura (cuando se active) solo requiere cambiar una regla, no rediseñar.

### Negativas

- Overhead mínimo: fingerprint check al abrir store (1 read).
- Reindex completo puede ser caro en corpus grandes — aceptable: es evento raro.

### Mitigaciones

- Mantener siempre los documentos **fuente** accesibles (no solo los chunks embeddeados) permite reingestar sin pérdida.
- El cache sobrevive al cambio de modelo (solo cambian las keys), útil si se vuelve al anterior.
- Permitir opt-out (`allowSameDimDifferentModel`) para experimentación rápida.

## Implementation checklist (cuando llegue el momento)

- [ ] `VectorStore.initFingerprint(cfg)` escribe metadata al crear.
- [ ] `VectorStore.openExisting(cfg)` valida y lanza `EmbedderMismatchError`.
- [ ] `EmbeddingCache` ya incorpora modelo+dimensión en la key (cubierto en KJR-TSK-0052).
- [ ] Subcomando `karajan-rag reindex <config>` que borra y reingesta.
- [ ] Tests: store con fingerprint A que abre con config B falla; misma config abre ok.

## Links

- [ADR-001 — Karajan-style patterns](./ADR-001-kjc-reuse-strategy.md)
- [Inventario de mining KJC](../mining-kjc.md)
