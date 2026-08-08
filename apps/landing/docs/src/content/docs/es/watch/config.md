---
title: 'Configuración'
description: 'karajan-watch.config.json: el contrato entre el producto genérico y el repo de despliegue de cada organización, con validación estricta.'
---

<!-- synced-from: manufosela/karajan-watch@v0.3.0:docs/config.md · section-sha256: 2b0d9931d6247e45ae30b97385bd1c0b20e52157b271b52414d069af19fb1c76
     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->

Contrato entre karajan-watch (genérico, este repo) y el repo de despliegue
de cada organización (privado, suyo). TODO lo concreto de una organización
vive en este fichero, en su repo de despliegue — nunca aquí.

Se carga con `loadConfig(path)` / se valida con `validateConfig(object)`
(exportados desde el paquete). La validación es estricta: clave desconocida
o valor fuera de rango = `ConfigError` con el path exacto
(`$.corpus.code.store`), sin fallbacks silenciosos. Ejemplo completo en
[karajan-watch.config.example.json](https://github.com/manufosela/karajan-watch/blob/v0.3.0/karajan-watch.config.example.json).

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

**El backend del store lo instalas tú**: `@lancedb/lancedb` para `lancedb`,
`pg` para `pgvector`. El motor no declara ninguno, así que quien usa uno no
paga el binario del otro; si falta, la ingesta falla en rojo indicando cuál.

Con `lancedb` el corpus es un directorio en disco: sin servidor y sin nada
que alojar, pero **solo lo ve quien tiene ese disco**. Si `ingest` e `impact`
corren en máquinas distintas —o en runners efímeros que no conservan nada
entre jobs— el corpus tiene que persistirse aparte o el store debe ser
`pgvector`. Los dos umbrales de `impact` se calibran contra el store que uses:
los scores no son comparables entre backends.

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

### `contracts` (opcional)

Controla la señal de contratos (ver [docs/impact.md](../impact/)):

```json
{
  "contracts": { "enabled": true, "types": ["http", "event", "sql"] }
}
```

| Clave     | Tipo    | Default              | Notas                                   |
| --------- | ------- | -------------------- | --------------------------------------- |
| `enabled` | boolean | `true`               | `false` desactiva la señal por completo |
| `types`   | array   | los tres             | subconjunto de `http` \| `event` \| `sql` |

Sin esta sección la señal corre con los tres tipos. Un tipo desconocido
es un error con el path exacto (`$.contracts.types`).

### `policy` (opcional)

Sensitivity policy propia del despliegue: mapa nivel → adapters LLM
permitidos, validado con `validateSensitivityPolicy` de karajan-rag
(los tres niveles son obligatorios):

```json
{
  "policy": {
    "confidential": ["ollama"],
    "internal": ["ollama", "azure-openai"],
    "public": ["claude", "codex"]
  }
}
```

Sin esta sección rige `createDefaultSensitivityPolicy()` del motor.
Un adapter pedido explícitamente que la policy no permita para el nivel
efectivo es un error — nunca se degrada a otro adapter en silencio.

## Sensibilidad

Los niveles y su default heredan el modelo de karajan-rag
(`SENSITIVITY_LEVELS`, `DEFAULT_SENSITIVITY`): `public` | `internal` |
`confidential`, default seguro **`internal`**. El nivel efectivo gobierna
qué adapters LLM permite la policy en los juicios de F2/F3.
