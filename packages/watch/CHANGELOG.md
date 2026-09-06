# Changelog

## 0.8.0 — 2026-09-06

Minor porque la CONFIG crece:

### Nuevo

- **Clasificación en la config** (KJW-TSK-0037): `repos[].group`,
  `repos[].dora {service, tier}` y `corpus.docs.sensitivityRules
  [{prefix, level}]` — todo validado estricto con rutas JSON exactas,
  niveles cerrados al vocabulario de karajan-rag y prefijos duplicados
  rechazados. Nada de esto cambia el juicio todavía: es la base
  declarativa sobre la que se agrupan métricas y se etiqueta
  sensibilidad de docs.

## 0.7.0 — 2026-09-05

Minor porque el CONTRATO del juicio cambia (issue [#23](https://github.com/manufosela/karajan-watch/issues/23),
medición de campo: 80 merges en 11 días):

### Cambiado

- **La guarda anti-alucinación puntúa a la ENTRADA, no al merge**
  (KJW-BUG-0010): una entrada del veredicto con fuente sin respaldo ya NO
  lanza `JudgmentError` ni tira el juicio entero — se descarta con
  contador (`discardedEntries` en el resultado, logueado por el pipeline)
  y las entradas fundadas sobreviven. Con todas descartadas: veredicto
  vacío con contador, nunca error. En campo, 4/70 merges con retrieval
  perdían su informe completo por una sola entrada.
- **Con las tres señales vacías no se pide veredicto**: retrieval,
  co-cambios y contratos vacíos = nada contra lo que validar, no una
  alucinación que castigar. `judgeImpact` retorna temprano con
  `insufficientSignal: true` y un summary «sin señal suficiente» — antes
  el aborto era garantizado (8/8 en campo), y caía justo en los diffs
  quirúrgicos (1–9 chunks) que más interesa vigilar.

Migración: si tu tooling capturaba `JudgmentError` por fuente
desconocida, ese camino ya no existe — lee `discardedEntries` e
`insufficientSignal` del resultado.

### Nuevo

- **El veredicto declara su alcance** (KJW-BUG-0009, patrón confirmado en
  los dos casos con impacto real del golden de campo): el juez puede
  responder `{scope: "repo", source: "<repo>"}` cuando su conclusión
  aplica a un repositorio en conjunto — antes ese razonamiento se colgaba
  del fichero que el retrieval hubiera traído de ese repo, y un aviso
  correcto atribuido a un fichero sin relación se descarta por ruido. Las
  entradas repo se validan contra los repos que el juez VIO, entran al
  ranking como filas propias pesadas por severidad y el informe dice
  «repo `X`» sin fingir precisión de fichero. `scope` ausente = `file`.
- **`--adapter` y `--model` en el binario** (KJW-TSK-0040): el adapter
  del juez es elegible (la policy lo valida — sin degradación silenciosa)
  y el modelo viaja como opción del adapter — en campo, el modelo por
  defecto se saltaba el formato del veredicto y no había vía para fijar
  otro sin script propio. El log del descarte distingue además FORMATO
  (señal conocida escrita de otra forma) de DESCONOCIDA (posible
  invención).
- **El eval es honesto con el tiempo** (KJW-TSK-0042): un caso del golden
  declara `mergedAt` y `expectedRepos`, el eval AVISA cuando el índice es
  anterior al merge en vez de puntuar en silencio (caso real: la métrica
  de fichero daba 0 porque los ficheros correctos se crearon DESPUÉS de
  indexar — la de repo daba 2/2), hay métrica a nivel repo por caso y
  agregada, y `measuredWith` registra `corpusIndexedAt`. CLI:
  `--corpus-indexed-at`.
- **Aviso de repos observados inactivos** (KJW-TSK-0043): la config
  también caduca — en una instancia real, 13 de 29 repos llevaban 3 meses
  sin un merge y nada lo señalaba. El pipeline clasifica los repos por
  frescura de historia (umbral `impact.thresholds.inactivityDays`,
  default 90), loguea cada inactivo y los lista al pie del informe
  proponiendo retirar o confirmar — nunca un gate. La historia ilegible
  NO se acusa de inactiva: se dice aparte como no observable.

## 0.6.1 — 2026-09-04

Primera release de watch desde el monorepo karajan-code y primera publicada
en dual: `karajan-watch` y `@karajan-family/watch` — mismo commit, misma
versión en ambos nombres. Cierra además el hueco de npm: 0.5.0 y 0.6.0
quedaron tageadas sin publicar, así que esta 0.6.1 es la primera versión
en el registry desde la 0.4.0.

### Corregido

- **Los inputs de la ingesta viajan por env, no por shell** (KJW-BUG-0008):
  los valores que llegaban al paso de ingesta se interpolaban en la línea
  de comando, donde un contenido hostil podía alcanzar el shell. Ahora se
  pasan como variables de entorno y el comando queda estático.

## 0.6.0 — 2026-08-10

### Nuevo

- **Historial de informes** (`$.history`, opt-in). El comentario de una PR
  es efímero: cuando alguien pregunta si esto va a mejor o a peor, no hay
  nada que mirar. Ahora cada run de `impact` y `drift` puede guardar su
  informe —con la evidencia citada y con qué store y embedder se midió— en
  un `reports.ndjson`, con retención configurable.

  Va a **fichero, no a base de datos**: una instancia arranca sin Postgres y
  el historial no debería ser el motivo de montar uno. Desactivado por
  defecto: sin la sección, watch funciona exactamente como hasta ahora.

### Corregido

- **La redacción de PII corrompía el histórico.** Redactar el JSON ya
  serializado convertía un score como `0.15476923` en
  `"score":0.[REDACTED_CARD]` —la tirada de dígitos se leía como número de
  tarjeta— y el fichero dejaba de ser JSON válido. Ahora la redacción va
  campo a campo: los textos se limpian, los números se guardan tal cual. Lo
  encontró el smoke real; los tests con dobles usaban scores cortos.

## 0.5.0 — 2026-08-09

> Con esta versión, **los cuatro comandos y los tres workflows del producto
> se ejecutan de verdad** en cada PR, contra los dos stores. Ya no queda
> nada prometido que no se haya ejercitado al menos una vez.

### Nuevo

- **`eval` se ejecuta de verdad.** Era el único de los cuatro comandos que
  no ejercitaba nadie: existía, tenía tests con dobles y jamás se había
  ejecutado end-to-end. Ahora el smoke lo corre contra los dos stores y
  comprueba su informe. Funciona — recall 1.00 sobre el consumidor del
  endpoint renombrado.
- **Los números del eval van firmados** con el store y el embedder que los
  produjeron. Unos umbrales calibrados con `lancedb` no significan lo mismo
  con `pgvector`, así que un número suelto es engañoso.
- **Plantilla de golden set** ([`golden-incidents.example.json`](./golden-incidents.example.json))
  válida de verdad, verificada por un test para que nadie la copie y se
  estrelle en su primer eval. Los incidentes reales siguen viviendo en el
  repo de despliegue de cada organización: contienen su código.

- **Una instancia es una lista de repos.** Hasta ahora había que decidir
  store, embedder y sensibilidad de dos corpus antes de poder ejecutar
  nada — decisiones que se toman mal justo antes de haber visto la
  herramienta funcionar. Ahora esto es un config completo y válido:

  ```json
  { "repos": [{ "name": "backend-api" }, { "name": "web-frontend" }] }
  ```

  El corpus arranca por la vía sin servidor y sin descargas (`lancedb` +
  `hash`) y con el nivel de sensibilidad seguro. **Los defaults no son
  silenciosos**: cada valor asumido se anuncia al arrancar cualquier
  pipeline, con su path y su valor. Y rellenar un hueco no es tragarse un
  error: un valor equivocado sigue fallando con su path exacto.
- El ejemplo de configuración que se publica pasa a ser el **mínimo**; el
  completo queda como referencia aparte.

## 0.4.0 — 2026-08-09

> **Si vas a montar una instancia, parte de aquí.** Hasta la 0.3.0 los tres
> workflows reusables no funcionaban en ningún despliegue: morían pidiendo el
> backend del store. Nadie lo había notado porque nadie los había ejecutado.

### Nuevo

- **El producto prepara su propio store pgvector.** Hasta ahora el esquema
  bueno solo existía dentro de `scripts/smoke.sh`: quien declaraba
  `store: pgvector` no tenía de dónde sacarlo, y la migración del motor
  declara `vector(768)` mientras la capa Easy indexa con 256 (hash) o 384
  (transformers) — seguirla al pie de la letra revienta el INSERT. Ahora la
  ingesta crea extensión, tabla e índices con la dimensión que corresponde
  al embedder configurado, de forma idempotente y **sin tocar un corpus que
  ya exista**. Si el esquema presente no cuadra con el embedder, falla antes
  de indexar diciendo qué hay y qué se esperaba, en vez de morir a mitad del
  INSERT. Y si faltan permisos de DDL, dice el SQL exacto que hay que pedir.

- **Cobertura medida y exigida en CI.** Hasta ahora "135 tests en verde" no
  decía nada sobre qué código se ejercitaba. La cifra real resultó ser
  buena —97,5% de líneas, 91,8% de ramas— y el gate exige los mismos
  mínimos que karajan-rag (95/95/92/87), por debajo de lo actual con
  margen: un listón clavado donde ya se llega salta con cualquier línea
  nueva y acaba desactivándose. Lo que queda sin cubrir son ramas de error
  difíciles de provocar en test —workspace ilegible, `spawn` real— que sí
  ejercita el smoke.

- **La deriva ya avisa de la documentación del propio repo.** Excluía
  siempre el repo de origen —correcto para el impacto cross-repo, que existe
  para mirar a los demás— y con ello se perdía el caso más común: el README
  que vive al lado del código que acaba de cambiar. Ahora entra, y lo que se
  deja fuera son los ficheros que el propio diff tocó, que no son
  documentación obsoleta sino el cambio mismo. Verificado en el smoke real:
  el README del repo que cambia sale primero, citando el endpoint eliminado.

### Corregido

Los tres workflows reusables —`ingest.yml`, `impact.yml`, `drift.yml`—
existían desde la primera versión y le pedíamos a cada organización que los
invocase, pero **no los había ejecutado nunca nadie**. Al ejecutarlos por
primera vez salieron cuatro fallos que impedían que funcionasen en
cualquier despliegue:

- **Ninguno instalaba el backend del store**, así que morían pidiendo
  `@lancedb/lancedb` o `pg`. Ahora lo deducen del store declarado en el
  config y lo instalan junto a karajan-watch.
- **`impact` y `drift` no restauraban el corpus** que dejó la ingesta: con
  un store de fichero corren en otra máquina y no había nada que consultar.
- **En `drift`, un `[ ] && …` bajo `set -e` abortaba el paso** cuando el
  juicio venía desactivado, que es el valor por defecto.
- **`impact` no exponía `--no-judge`**, que el CLI tiene desde la 0.2.0:
  quien no tuviera un adapter LLM en el runner no podía usar el pipeline.

### Nuevo

- **Los informes se publican como artifact** del job, para leerlos o
  archivarlos sin depender del log.
- Un self-test los ejecuta en cada PR que toque los workflows, sobre repos
  públicos reales y con store `lancedb`, y **comprueba lo que dicen los
  informes**, no solo que el job salga verde.

## 0.3.0 — 2026-08-07

> **Ya no necesitas una base de datos para probarlo.** Si te frenó tener que
> decidir dónde alojar un Postgres, esta es tu versión: empieza con
> `lancedb`, que es un directorio en disco, y deja `pgvector` para cuando el
> corpus crezca o varias máquinas lo compartan.

### Nuevo

- **El enlace duro entre código y documentación.** La deriva de docs (F3)
  buscaba parecido semántico; ahora busca además los identificadores del
  diff —rutas HTTP, topics de evento, tablas SQL— **literalmente** en la
  documentación. Que un manual contenga el endpoint que acabas de borrar no
  es que se parezca: es que ese documento miente. Esas secciones entran al
  informe aunque el retrieval no las hubiera traído, van por delante de las
  de solo similitud, y el informe cita el identificador que quedó obsoleto.
  Ni el juicio LLM las descarta: una cita literal no la tumba una opinión.

- **Se puede usar sin base de datos.** El store `lancedb` —un directorio en
  disco, sin servidor— ya estaba admitido en la configuración, pero no lo
  ejercía nada: era una promesa. Ahora el smoke end-to-end corre contra los
  dos stores desplegables, y el de `lancedb` va en CI **sin service
  container**, que es justo la demostración. Empezar ya no exige decidir
  dónde alojar un Postgres.
- **El paquete anuncia lo que necesita**: `@lancedb/lancedb` y `pg` quedan
  declarados como peers opcionales. El motor no arrastra ninguno, así que
  quien usa un store no paga el binario del otro; hasta ahora quien instalaba
  karajan-watch no podía indexar con **ningún** store y solo lo descubría al
  ejecutar.
- Documentado el límite real de la vía sin servidor —el corpus vive en el
  disco de quien indexa, así que en runners efímeros hay que persistirlo o
  usar `pgvector`— y que los scores no son comparables entre backends.

## 0.2.0 — 2026-07-29

> **Si estás en 0.1.0, actualiza.** Aquella versión tenía la ingesta rota:
> `karajan-watch ingest` moría con `ENOENT` antes de indexar nada salvo que
> tuvieras karajan-rag instalado globalmente.

### Nuevo

- **Cuarta señal del impacto: contratos.** Las otras tres son heurísticas
  (similitud, correlación temporal, juicio LLM); esta busca acoplamiento
  declarado: identificadores del diff —rutas HTTP y paths de OpenAPI,
  topics de evento, tablas SQL— buscados **literalmente** en los demás
  repos. Un fichero con contrato compartido entra al ranking aunque el
  retrieval no lo hubiera traído, y va por delante del resto; los
  contratos **rotos** (identificadores que desaparecen) van primero.
  Configurable con la sección `contracts` (`enabled`, `types`).
- **Arranque por prompt de agente**: `docs/prompts/start.md`, servido en
  <https://watch.karajancode.com/start.md>. El agente pregunta lo que solo
  tú puedes decidir, monta tu repo de despliegue y se detiene a esperarte;
  nunca maneja tus secretos.
- `--no-judge` en el CLI para correr solo con señales, sin LLM.
- El pipeline informa de cada fase (chunks, candidatos, contratos,
  co-cambios, juicio) en vez de ser una caja negra.

### Corregido

Todo esto salió de ejecutar el producto de verdad contra pgvector con un
corpus de 13.894 chunks; los tests con dobles no lo veían.

- **La ingesta no funcionaba** salvo con karajan-rag global: el binario de
  la dependencia se resuelve ahora desde el propio paquete.
- **El prompt del juicio no estaba acotado**: 88.727 caracteres en un caso
  real. Ahora tiene topes por señal y declara lo que omite.
- **El guardia anti-alucinación tumbaba juicios legítimos** apoyados en
  co-cambios: ahora valida contra las tres señales, no solo el retrieval.
- **El juicio no tenía timeout**: un adapter lento dejaba el job ocupado
  hasta el tope del runner.
- **El proceso nunca terminaba**: el pipeline abría la conexión al store y
  no la cerraba, así que el job seguía vivo *después* de hacer el trabajo.

## 0.1.0 — 2026-07-26

Primera versión publicada. Producto completo de las tres fases del diseño:

### F1 — RAG compartido vivo
- Esquema de configuración `karajan-watch.config.json` validado
  estrictamente (repos, corpus code/docs, sensibilidad heredando el
  modelo de karajan-rag, umbrales, destinos de aviso, policy opcional).
- Ingesta por merge sobre workspace multi-repo (`karajan-watch ingest` +
  workflow reusable `ingest.yml`): reindex incremental con embedder
  local, sensibilidad estampada por repo, verificación de workspace
  completo (un workspace parcial destruiría el corpus) y reindex
  serializado por corpus.

### F2 — Impacto cross-repo
- Pipeline completo (`karajan-watch impact` + `impact.yml`): parser de
  diff a chunks-query, retrieval con exclusión del repo origen, minero
  de co-cambios git por ventanas temporales, juicio LLM gobernado por la
  sensitivity policy (sin degradación silenciosa de adapters) y ranking
  de riesgo con evidencia — nunca "probabilidades". Avisos por comentario
  de PR y/o webhook https con PII redactada.
- Eval con golden set de incidentes (`karajan-watch eval`):
  precision/recall@k como gate de calibración.

### F3 — Deriva de documentación
- `karajan-watch drift` + `drift.yml`: secciones de docs que mencionan
  lo cambiado, con enlaces fichero:línea y juicio LLM opcional.

### Seguridad y operación
- Embedders locales (el código nunca viaja a terceros), redactPII en
  toda salida, tokens fuera de URLs de clone, sin fallbacks silenciosos:
  el sistema funciona o falla en rojo.
