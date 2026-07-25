# Análisis de impacto cross-repo (F2)

Tras cada merge en un repo observado, el pipeline combina tres señales y
produce un **ranking de riesgo con evidencia** — nunca una "probabilidad":

1. **Retrieval**: cada chunk del diff como query contra el corpus `code`
   multi-repo, excluyendo el repo origen (`src/retrieval.js`).
2. **Co-cambios git**: qué tocaron históricamente los demás repos cerca
   de cambios en las mismas áreas (`src/cochanges.js`).
3. **Juicio LLM**: un adapter permitido por la sensitivity policy valora
   candidatos + co-cambios y emite un veredicto estructurado
   (`src/judgment.js`).

El informe (markdown, con PII redactada) se entrega a los
`notify.targets` del config: comentario en la PR y/o webhook https.
Señal fallida o destino caído = job rojo.

## CLI

```bash
karajan-watch impact \
  --config karajan-watch.config.json \
  --workspace .kjw-workspace \
  --repo backend-api \
  --diff merge.diff        # o '-' para stdin
  # [--corpus code] [--no-deliver] [--pr-number 42]
```

Imprime el markdown por stdout. Para el target `pr-comment` necesita
`GITHUB_REPOSITORY`, `GITHUB_TOKEN` y `--pr-number`.

## Workflow reusable

[`impact.yml`](../.github/workflows/impact.yml) monta el workspace
multi-repo **con historial** (`git-depth`, default 200 — la señal de
co-cambios lo necesita; la ingesta de F1 clona a depth 1), extrae el
diff `base-sha..head-sha` del repo mergeado y ejecuta el CLI:

```yaml
# repo de despliegue: .github/workflows/on-merge.yml
jobs:
  impact:
    uses: manufosela/karajan-watch/.github/workflows/impact.yml@main
    with:
      org: mi-organizacion
      repo: ${{ github.event.client_payload.repo }}
      base-sha: ${{ github.event.client_payload.base }}
      head-sha: ${{ github.event.client_payload.head }}
      pr-number: ${{ github.event.client_payload.pr }}
    secrets:
      REPOS_TOKEN: ${{ secrets.REPOS_TOKEN }}
      PG_URL: ${{ secrets.PG_URL_CODE }}
```

## Límites conocidos

- La policy de adapters es la default de karajan-rag
  (`createDefaultSensitivityPolicy`); hacerla configurable desde
  `karajan-watch.config.json` es una ampliación futura del esquema.
- La calibración con golden set de incidentes reales (precisión/recobrado
  del ranking, ajuste de `impact.thresholds`) es una card futura de eval.
