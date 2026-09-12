---
title: El Sentinel, gate a gate
description: Cada mensaje que imprime el Sentinel de Karajan, qué protege y qué significa cada escape KJ_ALLOW_*.
---

El Sentinel es el conjunto de hooks síncronos que `kj harden` instala en el harness de tu agente. Cada mensaje que imprime empieza por `karajan sentinel:` y termina con un enlace a su sección en esta página. El harness anfitrión puede envolverlo con sus propias palabras (Claude Code dice "stop says", "PreToolUse hook error"), el cuerpo es de Karajan.

Dos reglas aplican a todo lo de abajo. Primera: el Sentinel bloquea *antes* de que la acción se ejecute, no hay nada que deshacer, porque no ha pasado nada. Segunda: cada escape es una variable de entorno que antepones a UN comando simple (`KJ_ALLOW_X=1 git …`); se ignora en cadenas de comandos (`;`, `|`, `&`, `$( )`, backticks, `2>&1` cuenta), y cada uso queda registrado en el estado de la sesión y sellado en el acta de decisiones. Un escape es una excepción consciente y auditable, nunca un ajuste.

## En la práctica, desde tu agente

Tú no ejecutas el Sentinel; él vigila la sesión de tu agente. Cuando Claude Code (o Codex, Antigravity, el asistente de VS Code) va a hacer algo que el proyecto prohíbe, commitear directo a `main`, editar un fichero del supervisor, correr un comando mutador que no se puede verificar, la acción se detiene *en el momento*, y el motivo aparece en la sesión con un enlace a la regla exacta de abajo:

```
karajan sentinel: card-first, work needs a tracked card before it starts …
  doc: https://karajancode.com/docs/es/guides/sentinel/#card-first
```

Tu agente lo lee, hace en su lugar lo sancionado (rama primero, preguntarte, usar `kj worktree`), y sigue. No configuraste nada, `kj harden` puso ahí al vigilante una vez, y él se explica cada vez que actúa.

## Bajo el capó, pruébalo tú mismo

El Sentinel es un conjunto de hooks síncronos de git/harness. Mira dónde viven, y observa uno dispararse:

```sh
cat .karajan/hooks/pre-commit          # las guardas generadas (no las edites a mano, son de kj harden)
git commit -m "wip" -- .               # en main, o sin card → bloqueado, con el enlace a la regla
```

Cada bloqueo, y cada escape `KJ_ALLOW_*` que uses conscientemente, queda sellado en el acta de decisiones, así que "¿qué detuvo el Sentinel, y lo anuló alguien?" está a un `kj policy report` de distancia.

## card-first

El trabajo necesita una card registrada antes de empezar. Editar fuentes en la rama base, o en una rama cuyo nombre no referencie ninguna card, queda bloqueado. Crea la card (`kj hu add`), muévela a running, y trabaja en una rama `feat/<CARD-ID>-descripcion`. Escape: `KJ_ALLOW_NO_CARD=1`.

## cross-lane

Desde MONO-0, cada sesión muta solo su propio carril (worktree); leer es libre. La guarda también rechaza mutaciones que no puede verificar: `cd` en una cadena mutadora, sustitución de comandos, expansión de shell, o redirecciones cuyo destino se esconde tras una variable, usa `git -C`, `npm --prefix` y rutas literales. Cruce deliberado: `KJ_ALLOW_CROSS_LANE=1` en un comando simple.

## identity

El bloqueo de identidad (ADR 0005): `gh`, `git push` y los comandos que firman commits deben correr bajo la cuenta que este clon declara (`kj identity set`). Nació de un incidente real, una llamada `gh` sin conmutar publicó como una cuenta de cliente en un repo público. Escape: `KJ_ALLOW_IDENTITY=1`.

## board-sync

Una card mergeada debe moverse en el tracker antes de que avance nada más, commit, push, nuevo PR, otro merge, o terminar el turno. Límpialo con la llamada real al tracker (`update_card` vía MCP, o `kj hu move`). Escape: `KJ_ALLOW_BOARD=1`.

## policy

`.karajan/policy.yml` se evalúa en cada llamada a herramienta. Un deny nombra su regla y su motivo. Las reglas etiquetadas como seguridad NO tienen escape NI arbitraje. Para el resto: `KJ_ALLOW_POLICY=1` (el commit además exigirá `KJ_POLICY_REASON`).

## steward

El barrido del Steward puede declarar el estado del proyecto lo bastante malo como para bloquear el inicio de trabajo nuevo (invariantes de seguridad, main persistentemente en rojo, solo donde el proyecto lo activó). Remedia lo que nombre el informe, o escapa por esta sesión: `KJ_ALLOW_STEWARD=1`.

## claims

Un dato firme en el cuerpo de un PR o en el mensaje final que quede DESMENTIDO por las propias salidas de este turno es una alucinación probada, el PR se rechaza antes de existir. Verifica el dato o márcalo como no verificado. Detalle: `kj claims check`.

## release

`kj release check` debe estar en verde antes de que se publique o despliegue nada. El único huevo-y-gallina legítimo: la landing muestra la versión nueva solo *después* de la publicación, ese paso corre bajo `KJ_ALLOW_RELEASE=1`, registrado como cualquier otro escape.

## supervisor

Los propios ficheros del Sentinel (`.karajan/harness`, hooks) son de solo lectura desde dentro de una sesión, un supervisor que una sesión puede editar no es un supervisor. Solo el humano lo desmonta o lo regenera (`kj harden`), fuera de la sesión. La manipulación se detecta contra lo que el propio kj instalado escribiría.

## stop-gate

El turno no puede terminar mientras el método esté en rojo: suite fallando, diffs sin revisar, movimientos de board pendientes, afirmaciones sin respaldo. Resuelve las violaciones listadas o pide a tu usuario el escape aplicable. Estado: `kj sentinel status`.

## push-gate

Igual que el stop gate, en el momento del `git push`: nada sale de la máquina con el método en rojo.

## attribution

La atribución a IA está prohibida por una regla determinista del proyecto, en todas partes, sin escape. Tres capas la imponen: el hook commit-msg la rechaza en los mensajes de commit; el hook pre-commit escanea las líneas AÑADIDAS del diff staged (changelog, docs, comentarios de código, *mencionar* una herramienta sigue siendo legal, atribuir no); y el Sentinel escanea cada comando `gh` que publica texto (crear/editar/comentar/revisar PR/issue/release), incluido el contenido de `--body-file`/`--notes-file`, un fichero ilegible tampoco publica. El CI re-comprueba commits, cuerpo y título del PR. Nació de una pillada real: 15 cuerpos de PR llevaron un pie de atribución porque solo se escaneaban los mensajes de commit (KJC-BUG-0164).

## escapes

Cada escape, qué se salta, y cuándo es legítimo. Todos: un comando simple, un uso, registrado en el estado de la sesión y sellado en el acta de decisiones, `kj sentinel status` lista lo que esta sesión usó.

| Escape | Se salta | Legítimo cuando |
| --- | --- | --- |
| `KJ_ALLOW_NO_CARD=1` | card-first | Fix de emergencia acordado con tu usuario antes de que exista la card |
| `KJ_ALLOW_CROSS_LANE=1` | guardas de cross-lane / ruta no verificable | Un cruce deliberado y anunciado (p.ej. publicar desde el worktree de un tag) |
| `KJ_ALLOW_IDENTITY=1` | bloqueo de identidad | Suites de test que ejercitan otras guardas; nunca para pushes reales |
| `KJ_ALLOW_BOARD=1` | board-sync | El propio tracker está caído y el movimiento queda en cola |
| `KJ_ALLOW_POLICY=1` | denies de policy no-seguridad | La regla se dispara mal y el fix está acordado; el commit además necesita `KJ_POLICY_REASON` |
| `KJ_ALLOW_STEWARD=1` | bloqueo duro del steward | La rotura es conocida, cardeada, y el usuario dice que el trabajo continúa |
| `KJ_ALLOW_RELEASE=1` | release check | El orden publicación→landing de arriba |
| `KJ_ALLOW_NO_TESTS=1` | gate de tests-con-código (código staged sin cambios de test) | El diff genuinamente no debe test y está acordado |
| `KJ_ALLOW_PII=1` | bloqueo de la denylist de privacidad en el commit | Un falso positivo confirmado, revisado por el humano |
| `KJ_ALLOW_REWRITE=1` | la guarda contra reserializar ficheros JSON enteros desde Bash | Reescribir el fichero entero ES el cambio acordado |
| `KJ_ALLOW_WRITE=1` | el bloqueo de Write sobre fichero existente (usa Edit) | Una regeneración completa es justo lo que se pidió |

No hay ningún `KJ_ALLOW_*` para los hallazgos de seguridad. Ese es el objetivo.
