# Cómo escribir un gestor de tareas

Un gestor de tareas es el sitio donde un proyecto guarda sus historias (HU): GitHub Issues, Linear, tu propia herramienta.
karajan-code habla con él a través de un contrato pequeño, así que un gestor es un paquete que cualquiera puede escribir.
Esta es la guía; el punto de partida para copiar está en [`packages/story-contract/template/`](../../packages/story-contract/template/).

## El contrato

Depende solo de `@karajan-family/story-contract` (no importa nada de karajan-code). Un gestor ofrece cuatro operaciones, cada una devuelve un `Hu`:

| Operación | Qué hace |
|---|---|
| `create({ title, acceptanceCriteria, tests, ref })` | crea una historia `pending` |
| `list()` | todas las historias |
| `move(id, status)` | cambia el estado y vuelve a leer la historia |
| `claim(id, who, { release })` | dice quién tiene la historia |

Un `Hu` tiene `short_id`, `title`, `status`, `claimed_by` y `ref`. Partes opcionales: `isId(ref)`, `canonicalId(ref)` e `idHint` (el formato de id de tu sistema; el núcleo nunca supone `HU-<n>`). Obligatorias: `capabilities` (`acceptanceCriteria: field|body`, `dependencies: none|partial|graph`, `assignee`, `verdicts: pr|comment|none`, `offline`) y `credentials` (nombres de variables de entorno, `[]` si no hay). `assertManager(manager)` falla en voz alta ante cualquier falta.

El núcleo también usa `manager.write.move`, `manager.write.claim` y `manager.assertNotHeld`, pero son optimizaciones opcionales, no parte del contrato ni de `assertManager`: `write` evita la relectura tras escribir y `assertNotHeld` es una comprobación más barata de "lo tiene otra persona". Sin ellas el núcleo usa `write = { move, claim }` del contrato y lee la tarjeta con un solo `list()` para rechazar una tarjeta en `running` que tiene otra persona (`HuClaimedError`).

## La fábrica

El paquete exporta `createManager({ config, env, run })`: `config` es tu bloque de `board.yml`, `env` el entorno, `run` un ejecutor de comandos inyectable. El registro además pasa `projectDir` y `board`. Mira `packages/board-github/src/index.js`.

## Lo que promete el núcleo

- **Caché y cola sin red.** `list` se guarda en caché con cada respuesta; si el servicio no contesta, se lee la caché y los movimientos se encolan, y se aplican en orden cuando vuelve. Un movimiento que el servicio rechaza se avisa y se descarta, nunca se fuerza. Crear sin red se rechaza: un id solo lo acuña tu servicio.
- **Espejo.** Cada lectura reescribe un plan de solo lectura para que el HU Board muestre las historias.
- **Regla de la carrera por reservar.** Una historia en curso que tiene otra persona solo se mueve con una liberación explícita.
- **Errores por nombre.** El núcleo reconoce los errores por `err.name` (`isOffline`, `isRefusal`), nunca por `instanceof`.

## Lo que debe aportar tu gestor

- **Ids opacos.** El id es el que dio tu servicio; el núcleo lo devuelve tal como lo recibió.
- **Los tres errores**, de `@karajan-family/story-contract`: `BoardOfflineError` (no alcanzó el servicio: el núcleo puede encolar), `BoardRejectedError` (contestó que no), `HuClaimedError` (la tiene otra persona).
- **Relectura tras cada escritura.** `move` devuelve lo que el servicio dice ahora y lanza `BoardRejectedError` si no coincide.
- **Exactamente un estado por historia.** Cero o varios es un `BoardRejectedError`, no una suposición.
- **Credenciales solo del entorno.** Lista los nombres de variable en `credentials`. Nunca un secreto en `board.yml` (el núcleo rechaza claves llamadas como `key`, `token`, `secret`, `password`) ni en un mensaje de error.

## Pruébalo

`@karajan-family/story-contract/suite` (solo para tests, necesita `vitest`) ejecuta el comportamiento compartido contra tu gestor:

```js
import { runStoryContract } from "@karajan-family/story-contract/suite";

// makeManager() devuelve { manager, backend }: tu gestor y un simulacro de tu servicio
// con rejectMoves() y corrupt(shortId, n) para provocar los rechazos.
runStoryContract("my manager", makeManager);
```

El test de la plantilla es `tests/hu/manager-template.test.js`; `packages/board-github/tests/github-story-contract.test.js` hace lo mismo con `gh` simulado.

## Nombres

`@karajan-family/board-<nombre>` es para gestores de la familia; a la comunidad se le sugiere `kj-board-<nombre>`. Ambos son convenciones, el código no las comprueba.

## Activar uno en un proyecto

`kj hu backend <github | linear | local>` escribe `.karajan/board.yml`; también puedes editarlo. El fichero tiene `backend` y un bloque con el nombre del gestor, por ejemplo:

```yaml
backend: linear
linear:
  team: ENG
  label: kj:hu
  states: { pending: Todo, running: In Progress, done: Done, failed: Canceled, skipped: Backlog }
```

Para GitHub es `backend: github` con `repo: owner/repo`. El bloque llega a `createManager` como `config`.

## Cargar un gestor de la comunidad: la lista de permitidos

Un gestor es código que corre con los permisos del agente y ve sus credenciales, así que uno de la comunidad solo se carga si `.karajan/board.yml` lo lista, con versión exacta:

```yaml
backend: acme
acme: { workspace: w }      # el bloque con el nombre del backend, llega a createManager como config
managers:
  allow:
    - { name: kj-board-acme, version: 1.2.3 }
```

- El nombre del backend es el del paquete sin `@scope/` y sin un `board-` o `kj-board-` inicial (`@x/kj-board-acme` responde a `acme`). Dos entradas para un backend, o un nombre que taparía `github`, `linear` o `local`, son errores; los gestores incluidos cargan siempre primero.
- `name` es un nombre de paquete npm y `version` una versión exacta (sin rangos ni etiquetas).
- **kj nunca instala.** Instala el paquete tú (`npm install --save-exact <name>@<version>`). Se resuelve desde el proyecto; si falta o su versión instalada no es exactamente la listada, kj lo rechaza y dice por qué.
- **Un paquete instalado que no está listado no se ejecuta nunca**: kj no lo importa.
- El módulo debe exportar `credentials` (los nombres de variables que necesita) y `createManager`. Recibe solo esas variables en `env`; los valores nunca se imprimen.
- El resultado debe pasar `assertManager`. La suite de conformidad compartida no se ejecuta al cargar, porque no puede correr contra un servicio real.
- `kj doctor` muestra la lista, el gestor cargado y su versión, sus capacidades y las credenciales que faltan; un rechazo muestra el motivo y el arreglo.
- Un cambio en `allow` pasa por una pull request, como una dependencia.

## Sin verificar

- `@karajan-family/story-contract` es un paquete del workspace aquí; no pude confirmar que esté publicado en npm, así que la dependencia `^0.1.0` de la plantilla es la versión de este repo.
- El segundo gestor incluido, Linear (`packages/board-linear`), aún no tiene `manager.js` en este árbol: solo su cliente y su configuración.
