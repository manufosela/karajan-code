# La integridad de los guardias del Sentinel frente a procesos fuera de la sesion

Status: proposed
Date: 2026-10-25

## Context

Auditoría del sello de gobierno (25-oct-2026, KJC-BUG-0402). Los guardias del Sentinel son ficheros del proyecto: `.claude/settings.json` llama a `node .karajan/harness/*.mjs`, y esos `.mjs` están fuera de git. Si un proceso lanzado aparte (un script que el agente arranca por Bash, cuyo contenido el Sentinel no lee) los cambia:

- La comprobación de manipulación (`kj sentinel verify`, cuya raíz de confianza es el paquete kj instalado, fuera del proyecto) solo corre en el hook Stop, al cerrar el turno (`src/harden/sentinel-hooks.js`, STOP_BODY). Hasta entonces, el guardia cambiado gobierna, o deja de gobernar.
- Falla abierta tras 3 bloqueos seguidos y cuando kj no está en el PATH, por la regla de que un fallo del Sentinel nunca bloquea la sesión para siempre.
- El CI no puede juzgar los guardias (no están en el checkout); los hooks de git sí, porque viajan con el repo.

Límite que hay que decir en voz alta: ningún mecanismo local resiste a un proceso con el mismo usuario del sistema operativo, porque ese proceso puede cambiar también lo que comprueba. Las anclas de confianza reales son el CI juzgado por la base (KJC-BUG-0399), los permisos de GitHub de la identidad del agente (KJC-TSK-1200) y, en local, separar usuarios del sistema (la guía de endurecimiento, capas 2 y 3).

## Options

A) Los guardias se ejecutan desde el paquete kj instalado (elegida para debatir). `.claude/settings.json` llama a `kj sentinel hook <nombre>`, el código vive fuera del árbol del proyecto, y lo que queda en el proyecto es solo el cableado, que ya protegen el Sentinel y la regla del supervisor. Cambiar un fichero del proyecto deja de cambiar la lógica del guardia. Coste: un arranque de kj por hook (hoy PreToolUse ya arranca kj para `policy eval` en las ediciones y en Bash).

B) Comprobar la integridad en cada PreToolUse, contra el kj instalado, y no fallar abierto en la integridad. Es más pronto que el Stop, pero la comprobación vive en el mismo guardia que se puede cambiar: un atacante cambia primero ese.

C) Como si el código no existiera: el Sentinel no defiende frente a procesos del mismo usuario y lo dice; la integridad la dan el usuario separado del sistema para el agente y el CI. Es lo honesto, pero deja sin red al usuario que no separa usuarios.

## Decision (propuesta)

A, más dos cambios pequeños: la comprobación de integridad también al arrancar la sesión (SessionStart) y antes de cada commit (pre-commit), y la manipulación detectada deja de fallar abierta: bloquea con el remedio (`kj harden`), porque una manipulación no es un fallo del Sentinel. Se mantiene el fallo abierto para los errores propios del Sentinel (estado corrupto, git caído). La documentación dice el límite del mismo usuario y enlaza la guía de endurecimiento.

## Consequences

La lógica de los guardias deja de poder cambiarse editando el proyecto; lo que se puede tocar fuera de la sesión es el cableado de `.claude/settings.json`, que una PR no puede cambiar sin que la policy lo deniegue y que el SessionStart comprueba. Cada hook arranca kj: se mide la latencia y, si pasa de un umbral, se agrupan los hooks en un solo arranque. Migración: `kj harden` reescribe el cableado y retira los `.mjs`; es un cambio del supervisor, así que entra con el sello de la persona.
