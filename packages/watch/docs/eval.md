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

**Los números van firmados con el store y el embedder** que los produjeron:

```
agregado: precision 0.33 · recall 1.00 → PASSED
medido con: store lancedb · embedder hash
```

No es decorativo. Los scores de similitud **no son comparables entre
backends** (propuesta upstream KJR-PRP-0010): unos umbrales calibrados con
`lancedb` no significan lo mismo con `pgvector`, donde además pueden salir
negativos. Si cambias de store, la calibración hay que rehacerla.

## Por dónde empezar

[`golden-incidents.example.json`](../golden-incidents.example.json) es una
plantilla **válida de verdad** —hay un test que lo comprueba, para que nadie
la copie y se estrelle en su primer eval— con dos casos que enseñan la forma:
un endpoint renombrado y una columna eliminada.

Los incidentes reales son de la organización y **viven en su repo de
despliegue**, no aquí: contienen diffs de su código. Aquí solo viajan el
esquema, la mecánica y ese ejemplo sintético.

Para construir el conjunto, la pregunta que hay que poder responder de cada
caso es concreta: *«este merge rompió aquello»*, con el fichero culpable y
el fichero roto identificados. Sin esa certeza el caso no sirve para medir.
