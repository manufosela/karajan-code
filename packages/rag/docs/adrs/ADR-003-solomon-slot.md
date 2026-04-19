# ADR-003 — Solomon: slot arquitectónico multi-source

- **Status**: proposed
- **Date**: 2026-04-19
- **Deciders**: equipo KJR
- **Related tasks**: KJR-TSK-0066 (stub + tipos), épica KJR-PCS-0014
- **PG ADR ID**: `-OqbSr2vHIT-80VzxVF4`

## Context

Cuando una query puede satisfacerse con chunks de **varios corpus distintos** — p. ej. documentación técnica + políticas internas + conversaciones previas — los scores de retrieval **no son directamente comparables** entre sources:

- Cada corpus tiene su propia distribución de scores (rango, media, varianza).
- La "calidad" de un score 0.85 en el corpus A puede ser peor que un 0.70 en el corpus B.
- La autoridad relativa entre sources puede variar según el contexto de la query.

Un retriever por source devuelve top-k local correctamente, pero **combinarlos ingenuamente** (concatenar + reordenar por score) produce resultados sesgados hacia el corpus con scores infladados.

**Solomon** es el árbitro que, dados múltiples retrievals paralelos por source, decide qué chunks priorizar tomando en cuenta estas diferencias.

## Decision

**Reservar el slot Solomon en la arquitectura AHORA, sin implementar la lógica todavía.**

### Contrato tipado

```js
/**
 * @typedef {Object} SolomonSourceResult
 * @property {string} source
 * @property {import('../vector-store/in-memory-vector-store.js').SearchHit[]} hits
 */

/**
 * @typedef {Object} SolomonInput
 * @property {string} query
 * @property {SolomonSourceResult[]} sourceResults
 * @property {number} [maxChunks]
 */

/**
 * @typedef {Object} SolomonVerdict
 * @property {import('../vector-store/in-memory-vector-store.js').SearchHit[]} chunks
 * @property {string} rationale
 * @property {Record<string, number>} sourceWeights
 */
```

### SolomonRole hoy

- Extiende `Role` (KJR-PCS-0002).
- Su `run(input)` lanza `Error('Solomon: not implemented, see ADR-003')`.
- Existe para que pipelines multi-source puedan declararlo sin romper al registrar el rol en el `RoleRegistry`.

### Implementación futura (cuándo y cómo)

Se implementa **cuando exista un caso multi-source real** en pipelines de usuario. Etapas previstas:

1. **Normalización**: z-score o min-max por corpus para hacer scores comparables.
2. **Ponderación**: señales como densidad de keywords, autoridad del source declarada en config, recency del documento.
3. **Opcional LLM arbitrage**: delegar a un CLI con prompt "dado el query y estos chunks agrupados por source, elige los más relevantes globalmente justificando por qué".
4. **Métricas**: logging de decisiones + feedback loop para auto-ajuste de pesos (futuro).

## Consequences

### Positivas

- El pipeline engine no requiere rediseño cuando llegue el caso multi-source.
- El contrato tipado permite a otros módulos referenciarlo (p. ej. `buildPipelineFromConfig` puede validar que un `solomon` stage tenga `sourceResults[]` de entrada) sin esperar a la implementación.
- Documenta por qué hace falta una capa por encima del reranking simple — evita que alguien implemente un merger ingenuo.

### Negativas

- Código muerto mientras no se implemente.
- Confusión potencial si alguien intenta usarlo en Sprint 1 y recibe "not implemented".

### Mitigaciones

- Claramente marcado como stub (error con referencia a este ADR).
- Test unitario verifica que el stub lanza con mensaje esperado (no "silent success").
- No se registra en `createDefaultRoleRegistry()` por defecto.

## Links

- [ADR-001 — Karajan-style patterns](./ADR-001-kjc-reuse-strategy.md)
- [Épica KJR-PCS-0014 — Solomon Arbitration](../../README.md)
