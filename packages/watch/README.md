# karajan-watch

> El vigía de la orquesta: observa lo que se mergea en tus repos, mantiene
> vivo un RAG compartido de todo tu código y tu documentación, y te avisa
> del impacto — qué otros repos pueden verse afectados por un cambio y qué
> documentación se queda desactualizada.

Parte de la familia **Karajan** ([karajan-code](https://github.com/manufosela/karajan-code),
[karajan-rag](https://github.com/manufosela/karajan-rag)). Usa
[karajan-rag](https://www.npmjs.com/package/karajan-rag) como motor de
indexado, retrieval y gobernanza de sensibilidad.

**Estado: 0.1.0** — F1 (ingesta), F2 (impacto) y F3 (deriva de docs)
implementadas. El diseño vive en [docs/design.md](./docs/design.md).

## Qué hace

1. **RAG compartido siempre fresco** — en cada PR mergeada de cualquier
   repo observado, reindexa incrementalmente el corpus compartido
   (código multi-repo y documentación, índices separados) y lo sirve a
   agentes vía MCP/HTTP. → [docs/ingest.md](./docs/ingest.md)
2. **Análisis de impacto cross-repo** — para cada merge: retrieval del
   diff contra los demás repos + historial de co-cambios de git + juicio
   LLM (gobernado por la sensitivity policy) → **ranking de riesgo con
   evidencia**, comentado donde el equipo trabaja.
   → [docs/impact.md](./docs/impact.md)
3. **Deriva de documentación** — cruza el diff con el corpus de docs:
   "esto que has cambiado aparece en estas secciones; revísalas".
   → [docs/drift.md](./docs/drift.md)

## Quickstart

Lo más rápido es pedírselo a tu agente. Pega esto en Claude Code, Codex,
Gemini CLI o Cursor:

> Quiero análisis de impacto cross-repo en mi organización: lee
> watch.karajancode.com/start.md y haz lo que dice.

El agente comprueba tu máquina, te pregunta lo que solo tú puedes decidir
(qué repos vigilar, la sensibilidad del código, dónde vive el corpus, dónde
quieres los avisos), monta tu repo de despliegue y **se detiene a esperarte**
en cada paso que necesite tu permiso. Nunca manipula tus secretos: te dice
cuáles crear y espera.

Esa URL redirige al prompt versionado en este repo,
[docs/prompts/start.md](./docs/prompts/start.md) — puedes leerlo antes de
pegarlo. Si prefieres no depender de una URL, instala primero el paquete y
pásale a tu agente la ruta local: el mismo prompt viaja en el tarball.

¿Prefieres a mano?

```bash
npm install karajan-watch @lancedb/lancedb   # Node >= 20
```

### Dónde vive el corpus

Lo eliges tú en `$.corpus.*.store`, y **el backend lo instalas tú**: el motor
no arrastra ninguno, así que quien usa un store no paga el binario del otro.
Si falta, la ingesta falla en rojo diciendo cuál instalar — nunca indexa a
medias.

| Store | Necesita | Cuándo |
|-------|----------|--------|
| `lancedb` (por defecto) | `@lancedb/lancedb`. Sin servidor: el corpus es un directorio | Para empezar, y para cualquier despliegue en el que la misma máquina indexa y consulta |
| `pgvector` | `pg` y un Postgres con la extensión `vector` | Cuando varias máquinas comparten corpus, o cuando quien indexa no conserva el disco |
| `in-memory` | nada | Tests. No persiste |

Empieza por `lancedb`: no tienes que decidir dónde alojar una base de datos
para saber si esto te sirve. Su límite es concreto y conviene conocerlo antes
de elegir — **el corpus vive en el disco de quien indexa**. En runners
efímeros, donde `ingest` corre en un job y `impact` en otro, ese disco
desaparece entre medias: o lo persistes (caché o artefacto entre jobs, disco
propio en un runner self-hosted) o usas `pgvector`, que es exactamente el
problema que resuelve.

En el repo privado de despliegue de tu organización:

1. Declara **qué repos vigilas**, y nada más si no quieres:

   ```json
   { "repos": [{ "name": "backend-api" }, { "name": "web-frontend" }] }
   ```

   Eso es un `karajan-watch.config.json` completo y válido: el corpus
   arranca sin servidor ni descargas, y cada valor asumido se anuncia al
   ejecutar. Corpus, sensibilidad, umbrales y destinos de aviso se declaran
   cuando hagan falta → [docs/config.md](./docs/config.md), con
   [ejemplo mínimo](./karajan-watch.config.example.json) y
   [completo](./karajan-watch.config.full.example.json).
2. Invoca los workflows reusables (`ingest.yml`, `impact.yml`,
   `drift.yml`) desde tus GitHub Actions, o usa el CLI directamente:

```bash
karajan-watch ingest --workspace .kjw-workspace --corpus code
karajan-watch impact --workspace .kjw-workspace --repo backend-api --diff merge.diff
karajan-watch drift  --workspace .kjw-workspace --repo backend-api --diff merge.diff
karajan-watch eval   --workspace .kjw-workspace --golden golden-incidents.json
```

Calibración del ranking con incidentes reales: [docs/eval.md](./docs/eval.md).
Contrato con el motor y gaps upstream: [docs/karajan-rag-contract.md](./docs/karajan-rag-contract.md).

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
