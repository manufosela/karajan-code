# Eval y calibración con golden set

La calibración de `impact.thresholds` no se hace a ojo: se mide contra un
**golden set de incidentes reales pasados** de la organización — cambios
que causaron daño colateral conocido. El golden vive en el repo de
despliegue (contiene diffs reales: es privado); aquí solo el formato y la
mecánica.

La eval corre el pipeline con **señales puras** (retrieval + co-cambios,
sin juicio LLM y sin entrega): métricas reproducibles, baratas y sin
depender de un adapter. No mide la calidad del juicio LLM — límite
documentado.

## Formato del golden set

```json
{
  "thresholds": { "precision": 0.5, "recall": 0.6, "k": 10 },
  "cases": [
    {
      "name": "cambio de timeout que rompió el consumidor",
      "repoName": "backend-api",
      "diff": "diff --git a/src/api.js b/src/api.js\n…",
      "expectedImpacted": ["web-frontend/src/api-client.js"]
    }
  ]
}
```

- `thresholds`: gate agregado. `precision`/`recall` en `[0, 1]` (los que
  se omitan no se exigen); `k` es el corte del ranking (default 10).
- `cases[].expectedImpacted`: paths namespaceados `repo/…` que realmente
  se vieron afectados por aquel cambio.
- Validación estricta: clave desconocida o valor fuera de rango = error
  con el path exacto.

## Uso

```bash
karajan-watch eval \
  --config karajan-watch.config.json \
  --workspace .kjw-workspace \
  --golden golden-incidents.json
```

Salida: precision/recall@k por caso y agregado. Si el agregado cae por
debajo de los umbrales → `FAILED` y exit code 1 (usable como gate en CI
tras cambiar umbrales, embedder o versión de karajan-rag).

## Métricas

- `precision@k` = aciertos / candidatos devueltos (hasta `k`).
- `recall@k` = aciertos / ficheros esperados.
- Agregado = media simple sobre los casos.
