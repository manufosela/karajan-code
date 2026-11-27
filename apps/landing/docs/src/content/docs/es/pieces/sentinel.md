---
title: El Sentinel
description: El vigilante dentro de la sesión de tu agente. Qué es, por qué existe, cuándo actúa, cómo se usa y qué no hace.
---

## Qué es

El Sentinel es un conjunto de hooks que `kj harden` instala en Claude Code. Claude Code los llama en momentos fijos de la sesión, y cada uno es un programa pequeño que responde sí o no. Cuando responde no, la acción no ocurre, y el agente lee por qué, con un enlace a la regla.

Los hooks viven en `.karajan/harness/` y se conectan en `.claude/settings.json`. Son copias, byte a byte, de los scripts de tu kj instalado, así que `kj sentinel verify` sabe cuándo alguien los ha cambiado.

## Por qué existe

Una regla escrita en un fichero se lee una vez. Tras una compactación el agente la ha perdido, y en mitad de una tarea larga se la salta sin darse cuenta. Recordársela no sirve: quien tiene que acordarse es quien lo olvidó.

El Sentinel no le pide al agente que se acuerde de nada. Comprueba en el momento de la acción, antes de que se ejecute, así que no hay nada que deshacer. Cada comprobación es código determinista: ningún modelo decide si se ha seguido el método.

## Cuándo actúa

| Momento | Qué hace |
|---|---|
| **Antes de cada llamada a una herramienta** | Bloquea lo que rompe el método, antes de que se ejecute. Mira la lista de abajo. |
| **Después de cada llamada** | Apunta lo que ha pasado en el [ledger](/docs/es/pieces/ledger/). Nunca bloquea. |
| **Cuando el agente quiere terminar el turno** | No le deja pararse con el método en rojo, ni con sus cards esperando sin decir por qué. |
| **Tras una compactación o al reanudar** | Le devuelve al agente las reglas que leyó al empezar, en corto, con el estado de la sesión. |

### Antes de cada llamada a una herramienta

Esto es lo principal que para. La [guía del Sentinel](/docs/es/guides/sentinel/) tiene todos los mensajes:

- Editar en la rama base (`main`), o en el carril de otra sesión.
- Empezar a trabajar sin card, o en una rama que no nombra ninguna.
- Editar código por el que no se ha preguntado al RAG del proyecto.
- Escribir ficheros del repositorio desde Bash, donde ninguna comprobación puede ver qué se escribe.
- Hacer commit sin un veredicto de revisión aprobado para ese diff exacto, o añadir ficheros con `git add -A`.
- Descartar cambios que la sesión no ha hecho (pueden ser trabajo tuyo sin commitear).
- Tocar los ficheros del propio supervisor o la configuración de gobierno (políticas, gates, reglas).
- Publicar atribución a una IA en una pull request, una issue o una release.
- Ejecutar `git` o `gh` con una cuenta distinta de la que declaró el clon.
- Saltarse una regla de tus propios ficheros Markdown, una vez que la has aprobado (`kj rules approve`).

### Cuando el agente quiere terminar el turno

El turno no termina mientras haya cards mergeadas sin mover en el board, código editado en la rama base o en una rama sin card, o código añadido sin tocar ni un solo test. Tampoco mientras las cards que ha cogido la sesión sigan esperando y el agente no diga por qué se para (`Me paro por <razón>` o `Stopping because <reason>`) con una razón que kj pueda comprobar.

**Tras 3 bloqueos seguidos, se aparta.** Deja terminar el turno, apunta el evento en el estado de la sesión y le dice al agente que revise `kj sentinel status` contigo. A partir de ahí deja terminar el turno hasta que la sesión vuelve a estar en verde. El motivo: a veces el agente no puede arreglarlo solo (necesita una decisión tuya, o kj se equivoca), y sin ese límite se quedaría en bucle, gastando tokens, sin poder preguntarte.

La retención por cards en espera lleva su propia cuenta y se aparta igual tras 3 retenciones seguidas.

Apartarse solo deja que el agente deje de hablar. No deja entrar nada en el repositorio: el commit sigue necesitando su veredicto, y el CI sigue corriendo en la pull request.

Hay un bloqueo que nunca se aparta: los scripts del supervisor cambiados fuera de `kj harden`. Eso no es un fallo del Sentinel, es una manipulación.

## Cómo se usa

No lo ejecutas tú. `kj harden` lo instala una vez y se explica solo cada vez que actúa. Tu agente lee el mensaje, hace lo que toca en su lugar y sigue.

- `kj sentinel status`: lo que ha hecho la sesión y cualquier violación por la que el fin de turno bloquearía.
- `kj sentinel verify`: si los scripts del disco son los que escribe tu kj instalado.

**Tú puedes apagarlo; el agente no.** Arranca el anfitrión con `KJ_SENTINEL_OFF=1` en su entorno. La variable se lee del entorno con el que arrancó el anfitrión, así que un comando que lance el agente no puede ponerla. Te puede hacer falta cuando kj falla o te bloquea por error, o cuando trabajas en el propio kj. Aun así, algunas protecciones siguen activas: los ficheros del supervisor, la configuración de gobierno, la clave del móvil, la atribución a IA, las issues para karajan-code y descartar cambios que la sesión no ha hecho. Los hooks de git y el CI no leen la variable.

Dentro de la sesión no hay escape (ADR 0015). Una decisión que es del proyecto tiene su propio cauce, y la tomas tú en tu terminal: una excepción con fecha con `kj policy grant`, una regla nueva con `kj rules approve`.

## Qué no hace

- **No juzga el código.** Comprueba el método (card, rama, revisión, tests tocados). Si el código está bien es cosa de la [revisión cruzada](/docs/es/v4/gates/).
- **No ejecuta tus tests** al terminar el turno, ni lee las revisiones.
- **No funciona fuera de Claude Code.** Codex y Gemini CLI reciben las mismas reglas en `AGENTS.md`, y los hooks de git y el CI se les aplican, pero no el Sentinel.
- **No protege un repositorio de alguien sin kj.** En la máquina de un compañero sin kj nada le para en local; en la pull request, el CI sí.
- **No te cuelga la sesión por un fallo suyo.** Si una comprobación falla mientras juzga un comando que cambia algo, ese comando se para y dice por qué. Todo lo demás (el control de fin de turno, el que escribe el ledger) se aparta ante sus propios errores.
