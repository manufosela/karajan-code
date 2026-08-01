# Deriva de documentación (F3)

Mismo esqueleto que el [análisis de impacto](./impact.md) con el corpus
`docs` como objetivo: tras cada merge de código, el diff se consulta
contra la documentación indexada y el informe lista **qué secciones
mencionan lo cambiado** y pueden quedar desactualizadas, con enlace
`fichero:línea` y evidencia.

- El retrieval reusa `findImpactCandidates` (exclusión del repo origen
  incluida) y filtra post-hoc a ficheros de documentación
  (`DOC_EXTENSIONS`: md, mdx, rst, txt, adoc) — workaround de
  KJR-PRP-0004 hasta que queryIndex exponga `sourceType`.
- **Contratos: el enlace duro código ↔ documentación.** Los mismos
  identificadores que mina F2 —rutas HTTP y paths de OpenAPI, topics de
  evento, tablas SQL— se buscan **literalmente** en el corpus de docs. Que
  un manual contenga la cadena `/api/v1/users/:id` que el diff acaba de
  borrar no es parecido semántico: es prueba de que ese documento miente.
  Por eso una sección con cita literal **entra al informe aunque el
  retrieval no la hubiera traído** (score 0) y se ordena por delante de las
  halladas solo por similitud; primero las que citan algo ya eliminado. El
  informe nombra el identificador concreto. Se apaga con
  `$.contracts.enabled: false`, igual que en F2.
- El **juicio LLM es opcional** (`--judge`): la deriva es una señal
  informativa y el default evita coste LLM. Activado, reutiliza el
  juicio de F2 (policy del config, veredicto estricto, redactPII) y el
  veredicto actúa como filtro de ruido: solo se listan las secciones
  que el juicio confirma. Una cita literal es la excepción: no la tumba una
  opinión, porque el documento nombra algo que ya no existe.
- Cero deriva = informe explícito (nunca silencio); señal fallida o
  destino caído = job rojo.

## CLI

```bash
karajan-watch drift \
  --config karajan-watch.config.json \
  --workspace .kjw-workspace \
  --repo backend-api \
  --diff merge.diff \
  # [--judge] [--no-deliver] [--pr-number 42]
```

## Workflow reusable

[`drift.yml`](../.github/workflows/drift.yml) — como `impact.yml` pero
sin historial profundo (no usa co-cambios):

```yaml
jobs:
  drift:
    uses: manufosela/karajan-watch/.github/workflows/drift.yml@main
    with:
      org: mi-organizacion
      repo: ${{ github.event.client_payload.repo }}
      base-sha: ${{ github.event.client_payload.base }}
      head-sha: ${{ github.event.client_payload.head }}
      judge: false
    secrets:
      REPOS_TOKEN: ${{ secrets.REPOS_TOKEN }}
      PG_URL: ${{ secrets.PG_URL_DOCS }}
```

## Límites conocidos

- El corpus `docs` indexa hoy el workspace completo (también código):
  coste y ruido asumidos hasta KJR-PRP-0005 (include globs por corpus).
- El anclaje de sección es la línea del hit, no el heading markdown:
  el chunking semántico de secciones pertenece al motor.
