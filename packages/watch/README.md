# karajan-watch

> El vigía de la orquesta: observa lo que se mergea en tus repos, mantiene
> vivo un RAG compartido de todo tu código y tu documentación, y te avisa
> del impacto — qué otros repos pueden verse afectados por un cambio y qué
> documentación se queda desactualizada.

Parte de la familia **Karajan** ([karajan-code](https://github.com/manufosela/karajan-code),
[karajan-rag](https://github.com/manufosela/karajan-rag)). Usa
[karajan-rag](https://www.npmjs.com/package/karajan-rag) como motor de
indexado, retrieval y gobernanza de sensibilidad.

**Estado: en diseño (pre-0.1.0).** El plan de fases vive en
[docs/design.md](./docs/design.md).

## Qué hace (visión)

1. **RAG compartido siempre fresco** — en cada PR mergeada de cualquier
   repo observado, reindexa incrementalmente el corpus compartido
   (código multi-repo y documentación, índices separados) y lo sirve a
   agentes vía MCP/HTTP.
2. **Análisis de impacto cross-repo** — para cada merge: retrieval del
   diff contra los demás repos + historial de co-cambios de git + juicio
   LLM (gobernado por la sensitivity policy) → **ranking de riesgo con
   evidencia**, comentado donde el equipo trabaja.
3. **Deriva de documentación** — cruza el diff con el corpus de docs:
   "esto que has cambiado aparece en estas secciones; revísalas".

## Qué NO es

- No es un motor RAG: eso es karajan-rag. Aquí vive la orquestación.
- No contiene datos de ninguna organización: todo es parametrizable
  (repos, corpus, umbrales, adapters, destinos de aviso). La
  configuración concreta de cada organización vive en SU propio repo de
  despliegue, que instala karajan-watch + karajan-rag.
- No emite "probabilidades" calibradas de rotura: emite un ranking de
  riesgo con evidencia (similitud, co-cambios, veredicto LLM), evaluable
  contra un golden set de incidentes reales.

## Las tres capas de la familia

| Capa | Repo | Contenido |
|------|------|-----------|
| Motor | `karajan-rag` | index/query/serve/eval, sensitivity policy, redactPII, stores |
| Producto | `karajan-watch` (este) | ingesta por merge, pipeline de impacto, cruce código↔docs |
| Despliegue | uno por organización (privado, de la organización) | repos observados, niveles de sensibilidad, GCP/infra, umbrales, tokens |

Regla de reparto: si menciona a una organización concreta, va en su capa
de despliegue. Si le sirve a cualquiera, va aquí. Si es mecánica pura de
RAG, va a karajan-rag.

## Licencia

AGPL-3.0-or-later — © [@manufosela](https://github.com/manufosela)
