# ADR-004 — Solomon: implementación real de estrategias de arbitraje

- **Status**: accepted
- **Date**: 2026-04-20
- **Deciders**: equipo KJR
- **Related tasks**: KJR-TSK-0085 (implementación), KJR-TSK-0086 (este ADR)
- **Supersedes**: [ADR-003](./ADR-003-solomon-slot.md) (slot arquitectónico con stub)

## Context

[ADR-003](./ADR-003-solomon-slot.md) reservó el slot Solomon en la arquitectura **sin implementar la lógica** — `SolomonRole.run()` lanzaba un error explícito referenciando este ADR. El contrato tipado (`SolomonInput`, `SolomonVerdict`, `SolomonSourceResult`) quedó congelado para que los pipelines multi-source pudieran declararlo sin romper.

Con la implementación real en KJR-TSK-0085 llega el momento de:

1. Documentar **cómo** se resuelve el arbitraje (estrategias concretas).
2. Congelar la decisión de **quién paraleliza** los retrievers.
3. Estandarizar la **salida de auditoría** (`solomonDecision`).
4. Declarar formalmente que ADR-003 queda **superseded**.

## Decision

### 1. Tres estrategias configurables (sin dependencias runtime)

Se implementan tres estrategias como código puro, seleccionables con el parámetro `strategy` del constructor:

| Strategy       | Intuición                                                                            | Cuándo usarla                                                                     |
|----------------|--------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| `majority`     | Chunks que aparecen en varias sources suben; score = suma × co-ocurrencia.           | Default seguro: asume que el acuerdo entre sources es señal de relevancia.        |
| `weighted`     | Combinación lineal `score × sourceWeights[source]` (default 1.0 para sources no declarados). | Cuando se sabe a priori que ciertas fuentes son más fiables (política > chat).    |
| `llm-arbiter`  | Dedupe por id → callback externo `arbiter({query, candidates, sources})` decide.     | Casos complejos donde heurísticas no bastan; la lógica vive fuera de Solomon.     |

La estrategia por defecto es `majority`. Cambiar la estrategia **no** requiere cambiar el pipeline que declara el Solomon stage — solo se reconfigura el rol.

### 2. Solomon **no** paraleliza retrievers

El contrato de `SolomonInput` recibe `sourceResults` **ya calculados**. La paralelización (vía `Promise.allSettled` o equivalente) **queda explícitamente en el caller**.

Razones:

- Solomon no debería depender del stack concreto de retrieval. Acoplarlo a un `Retriever[]` lo obligaría a conocer dialectos (vector, BM25, hybrid, remote) que hoy viven en otros roles.
- Permite componer retrievers arbitrarios (incluso humanos / caché / dataset fijo) sin tocar Solomon.
- El caller ya tiene la información para decidir timeouts, cancelación y degradación graceful (`Promise.allSettled` vs `Promise.all`) — Solomon no tendría contexto para hacerlo bien.

Consecuencia: los ejemplos y la documentación deben mostrar el patrón de paralelización en el caller (para añadir en `examples/` en una PR futura de 0.2.x).

### 3. Registro de decisión estandarizado

Tras ejecutar, Solomon escribe en `ctx.metadata.solomonDecision`:

```js
{
  strategy: 'majority' | 'weighted' | 'llm-arbiter',
  rationale: string,
  sourceWeights: { [source]: number },
  sourcesCount: number,
  selectedIds: string[],
}
```

El campo vive en `metadata` (bolsa libre) y no en la raíz del contexto para no romper consumidores que no conocen Solomon. Es **opt-in para leer** y siempre se escribe (auditoría por defecto).

### 4. `arbiter` es obligatorio si `strategy === 'llm-arbiter'`

Construir un `SolomonRole` con `strategy: 'llm-arbiter'` sin pasar `arbiter` lanza en el constructor. No se hace fallback silencioso — preferimos fallar pronto y ruidosamente.

## Consequences

### Positivas

- Pipelines multi-source tienen arbitraje real sin dependencias pesadas.
- Tres estrategias cubren la mayoría de casos: default razonable (`majority`), control fino (`weighted`) y escape hatch (`llm-arbiter`).
- Auditoría integrada: `solomonDecision` permite instrumentar sin reconstruir la lógica.
- Solomon sigue sin conocer nada del stack de retrieval → acoplamiento mínimo.

### Negativas / deuda asumida

- `llm-arbiter` en 0.2.x **solo expone el callback**; no se proporciona un arbiter LLM auditado out-of-the-box. Eso llega con el módulo de evaluación avanzada en 0.3.0 (ver [ROADMAP.md](../../ROADMAP.md)).
- La paralelización en el caller implica que quien declara el pipeline tiene que escribir el boilerplate de `Promise.allSettled` + mapeo a `sourceResults`. Se compensará con un helper en `src/retrieval/` cuando aparezca el segundo ejemplo real.
- `majority` usa bonus multiplicativo por co-ocurrencia, no una fórmula más sofisticada (Reciprocal Rank Fusion, CombSUM normalizado…). Basta para 0.2.x; si los benchmarks muestran que no basta, se revisa con un ADR-005 sin romper el contrato.

### Breaking changes

- **Sí**: `SolomonRole.run()` ya no lanza. Los tests que esperaban `"Solomon: not implemented, see ADR-003"` se actualizan (hecho en TSK-0085). No hay consumidores externos en serie 0.1.x, por lo que el impacto es 0.

## Alternativas consideradas

- **Paralelizar dentro de Solomon**: rechazado por acoplamiento (ver §2).
- **Una sola estrategia configurable por callback**: sería más flexible pero menos usable — forzaría al usuario a escribir incluso el caso trivial `majority`. Tres estrategias built-in + callback cubren ambos extremos.
- **Dependencia a un framework de retrieval fusion externo** (p. ej. rankers RRF de alguna lib): rechazado por la restricción de "dependencias runtime mínimas" del proyecto. Si llega la necesidad, se envuelve como adapter opcional.

## Follow-up

- [KJR-TSK-0087] Generator streaming — no depende de Solomon pero cierra la tanda inicial de 0.2.0.
- Helper de paralelización en `src/retrieval/` cuando aparezca un segundo caller multi-source real.
- Re-evaluar `majority` si los benchmarks de 0.3.0 lo ponen por debajo de RRF.
