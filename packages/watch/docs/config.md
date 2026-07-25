# karajan-watch.config.json

Contrato entre karajan-watch (genérico, este repo) y el repo de despliegue
de cada organización (privado, suyo). TODO lo concreto de una organización
vive en este fichero, en su repo de despliegue — nunca aquí.

Se carga con `loadConfig(path)` / se valida con `validateConfig(object)`
(exportados desde el paquete). La validación es estricta: clave desconocida
o valor fuera de rango = `ConfigError` con el path exacto
(`$.corpus.code.store`), sin fallbacks silenciosos. Ejemplo completo en
[karajan-watch.config.example.json](../karajan-watch.config.example.json).

## Esquema

### `repos` (requerido)

Array no vacío. Cada entrada declara un repo observado:

| Clave         | Tipo   | Requerido | Default            | Notas                                              |
| ------------- | ------ | --------- | ------------------ | -------------------------------------------------- |
| `name`        | string | sí        | —                  | Único; namespace de sus paths en el corpus (`name/…`) |
| `branch`      | string | no        | `main`             | Rama cuyos merges disparan la ingesta              |
| `sensitivity` | enum   | no        | `internal`         | Ver [Sensibilidad](#sensibilidad)                  |

### `corpus` (requerido)

Exactamente dos entradas: `code` y `docs` (tablas/corpus separados).

| Clave         | Tipo | Requerido | Default    | Valores                              |
| ------------- | ---- | --------- | ---------- | ------------------------------------ |
| `store`       | enum | sí        | —          | `lancedb` \| `pgvector` \| `in-memory` |
| `embedder`    | enum | sí        | —          | `hash` \| `transformers` (locales: el código nunca viaja a un embedder de terceros) |
| `sensitivity` | enum | no        | `internal` | Ver [Sensibilidad](#sensibilidad)    |

### `impact` (opcional)

Umbrales del pipeline de impacto cross-repo (F2). Si la sección está
presente, `thresholds` es requerido:

| Clave                      | Tipo   | Restricción      |
| -------------------------- | ------ | ---------------- |
| `thresholds.minSimilarity` | number | en `[0, 1]`      |
| `thresholds.maxCandidates` | int    | `>= 1`           |

### `notify` (opcional)

Destinos de aviso. Si la sección está presente, `targets` es un array no
vacío. Tipos soportados:

- `{ "type": "pr-comment" }` — comentario en la PR mergeada.
- `{ "type": "webhook", "url": "https://…" }` — POST al webhook (solo https).

## Sensibilidad

Los niveles y su default heredan el modelo de karajan-rag
(`SENSITIVITY_LEVELS`, `DEFAULT_SENSITIVITY`): `public` | `internal` |
`confidential`, default seguro **`internal`**. El nivel efectivo gobierna
qué adapters LLM permite la policy en los juicios de F2/F3.
