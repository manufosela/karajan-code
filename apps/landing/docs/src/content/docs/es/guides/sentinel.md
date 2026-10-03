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

El trabajo necesita una card registrada antes de empezar. Editar fuentes en la rama base, o en una rama cuyo nombre no referencie ninguna card, queda bloqueado. Crea la card (`kj hu add`), muévela a running, y trabaja en una rama `feat/<CARD-ID>-descripcion`. Sin escape (ADR 0015).

## rag-first

El RAG tiene que haber respondido sobre una zona antes de que la sesión la toque (ADR 0010). Cada `kj_rag_query` / `kj rag query` de la sesión deja un registro de las fuentes que devolvió; editar una fuente que ninguna consulta devolvió (ni a ella ni a un hermano de su directorio) se bloquea indicando la consulta a hacer. Un fichero nuevo solo exige que la sesión haya consultado algo. Docs, config y tests quedan fuera, como en card-first. Un fichero que el índice no puede tener, o un índice vacío, los decide el propio gate. Sin escape (ADR 0015).

## cross-lane

Desde MONO-0, cada sesión muta solo su propio carril (worktree); leer es libre. La guarda también rechaza mutaciones que no puede verificar: `cd` en una cadena mutadora, sustitución de comandos, expansión de shell, o redirecciones cuyo destino se esconde tras una variable, usa `git -C`, `npm --prefix` y rutas literales. Cruce deliberado: `KJ_ALLOW_CROSS_LANE=1` en un comando simple.

## identity

El bloqueo de identidad (ADR 0005): `gh`, `git push` y los comandos que firman commits deben correr bajo la cuenta que este clon declara (`kj identity set`). Nació de un incidente real, una llamada `gh` sin conmutar publicó como una cuenta de cliente en un repo público. Escape: `KJ_ALLOW_IDENTITY=1`.

## board-sync

Una card mergeada debe moverse en el tracker antes de que avance nada más, commit, push, nuevo PR, otro merge, o terminar el turno. Límpialo con la llamada real al tracker (`update_card` vía MCP, o `kj hu move`). Una épica y una card partida en varias PRs las decide el gate. Sin escape (ADR 0015).

## policy

`.karajan/policy.yml` se evalúa en cada llamada a herramienta. Un deny nombra su regla y su motivo. Las reglas etiquetadas como seguridad NO tienen escape NI arbitraje. Para el resto: `KJ_ALLOW_POLICY=1` (el commit además exigirá `KJ_POLICY_REASON`).

## steward

El barrido del Steward puede declarar el estado del proyecto lo bastante malo como para bloquear el inicio de trabajo nuevo (invariantes de seguridad, main persistentemente en rojo, solo donde el proyecto lo activó). Remedia lo que nombre el informe, o escapa por esta sesión: `KJ_ALLOW_STEWARD=1`.

## claims

Un dato firme en el cuerpo de un PR o en el mensaje final que quede DESMENTIDO por las propias salidas de este turno es una alucinación probada, el PR se rechaza antes de existir. Verifica el dato o márcalo como no verificado. Detalle: `kj claims check`.

## release

`kj release check` debe estar en verde antes de que se publique o despliegue nada, y el guard reconoce el verbo donde quiera que caigan los flags (`firebase --project p deploy --only hosting` es un despliegue).

Un check en rojo nunca bloquea el comando que lo **repara**. El huevo-y-gallina era la landing: el check pedía el sitio desplegado con la versión nueva, el guard bloqueaba el despliegue, y la única salida era apagar el gate entero. Ahora el item declara su propio remedio:

```yaml
release_check:
  items:
    - name: la landing desplegada muestra la versión como current
      command: curl -sf https://example.com/docs/ | grep -q 'v{version}'
      remedied_by: firebase deploy
```

El check levantado sigue en rojo en el informe, porque el hecho no ha cambiado; solo deja de bloquear su propio arreglo, y el gate dice qué item ha levantado en lugar de hacerlo en silencio. Cualquier otro rojo sigue bloqueando. Publicar el paquete no se exime nunca: `npm publish` y `gh release create` son irreversibles, así que ningún remedio declarado los cubre, y `KJ_ALLOW_RELEASE=1` sigue siendo el único escape consciente.

## commit-gate

El review corre en el hook de commit, así que una bandera que se salta el hook se salta también el veredicto, la policy y el escaneo de privacidad. `git commit --no-verify` se deniega, y con él cualquier abreviatura que git aceptaría (`--no-ver`, `-n`, un grupo de flags cortos que lo lleve). Nombrar `core.hooksPath` también se deniega, por cualquiera de las puertas que git tiene para esa llave (`-c`, `config`, `--config-env`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_PARAMETERS`), porque moverla apaga todos los hooks de golpe. Leerla incluida: exceptuar las lecturas invitaba a colar una detrás del cambio, y volver a leerla te cuesta un escape mientras que perder el gate cuesta el veredicto.

Si el hook está roto, lo que toca es arreglarlo. No hay escape (ADR 0015): si el commit tiene que entrar igual, lo lanza tu usuario en su propia terminal. El `--no-verify` que `kj harden --commit` usa por dentro no se ve afectado, porque no pasa por una tool call.

## supervisor

Los propios ficheros del Sentinel (`.karajan/harness`, hooks) son de solo lectura desde dentro de una sesión, un supervisor que una sesión puede editar no es un supervisor. Solo el humano lo desmonta o lo regenera (`kj harden`), fuera de la sesión. La manipulación se detecta contra lo que el propio kj instalado escribiría.

Cuando no coinciden, kj distingue tres casos. Si el fichero es exactamente lo que escribió `kj harden` (guarda un sha256 por fichero en `.karajan/harness/installed.json`) y ningún humano lo selló, kj simplemente ha avanzado: lo regenera solo y lo dice en una línea. Si un humano lo selló, se deja como está y se avisa de que avanzarlo es cosa suya. Cualquier otra cosa se cambió después de instalarlo, y eso bloquea. Forjar el registro no sirve de nada: lo único que habilita es restaurar el fichero desde el kj instalado.

## discard

Una sesión no descarta cambios que no hizo. `git checkout -- <ruta>`, `git checkout <ruta>`, `git checkout .`, `git checkout -f`, `git restore` (del árbol de trabajo), `git reset --hard`, `git switch --discard-changes` y cualquier `git clean` que no sea un simulacro se deniegan cuando lo que tirarían incluye un fichero que no era de la sesión. Un fichero es de la sesión si estaba limpio, o no existía, la primera vez que la sesión lo tocó. Una edición encima de tu trabajo sin commitear no lo convierte en suyo: sigue siendo tuyo. Para `git clean` el Sentinel le pregunta a git qué se iría (`git clean -n` con las mismas opciones), así que también cuentan los ignorados con `-x` y los repositorios anidados con `-ff`. `git stash drop` y `git stash clear` se deniegan siempre, porque lo guardado puede no ser de la sesión. Un descarte git metido en `$( )`, backticks, `eval`, `xargs` o `sh -c` no se puede leer, así que también se deniega: ejecútalo como comando simple.

No hay escape, porque es pérdida de datos. El remedio nunca pierde nada: `git stash push -- <ficheros>` aparta el cambio, recuperable, y la sesión te avisa. Nace de una pérdida real: un coder decidió que una línea de `.gitignore` "la habría puesto el sistema" y ejecutó `git checkout .gitignore` sobre el cambio del usuario (issue #1886).

## bash-write

Dentro del repo, los ficheros se escriben solo con las tools Edit y Write, porque es el camino que guardan todos los demás gates (card-first, rag-first, no sobrescribir un fichero entero). Un comando Bash que escribe un fichero del repo se deniega: redirecciones (`>`, `>>`, `>|`, `2>`), `tee`, `sed -i`, `perl -i`, `cp`, `mv`, `install`, `ln`, `dd of=`, `truncate` y `touch`, también detrás de `env`, `sudo` o `command`. Un destino que el Sentinel no puede leer (`$VAR`, backticks) también se deniega. Un script en línea (`node -e`, `python -c`...) que nombra una API de escritura también se deniega. Fuera del repo (`/tmp`, un scratchpad, `/dev/null`) Bash sigue libre, y `git mv` renombra dentro. El límite, dicho claro: un programa que ejecutas puede escribir ficheros (un script, un build), y un hook que lee comandos no puede impedirlo; solo un sandbox puede. Este gate cierra las vías propias del shell para escribir, que es por donde un agente rodea Edit/Write. Nace de un rodeo real: bloqueado por rag-first, un coder escribió el mismo cambio con heredocs `cat >`, incluida la sobrescritura de un fichero entero (issue #1886).

## reminders

Un agente lee sus reglas al empezar y las pierde cuando el contexto se compacta. Un hook no olvida. Tras ciertas acciones, el Sentinel añade al contexto del agente la regla que toca a continuación. Nunca bloquea. Cada recordatorio sale como mucho una vez cada 25 acciones:

- tras `git add`, los límites del mensaje de commit (100 caracteres, sujeto en minúscula, sin atribución) y `commitlint`;
- tras un `gh` sin cambio de cuenta, nombrar la cuenta en el mismo comando;
- tras `gh pr create`, partir la card si no está terminada antes de mergear;
- tras sincronizar `main`, crear ya la rama siguiente.

Cada uno llega después de la acción que precede a la de la regla, no antes, porque un recordatorio antes de una herramienta tendría que aprobarla y saltarse tu pregunta de permiso.

Tras una compactación o al reanudar, el Sentinel le devuelve al agente las reglas críticas del proyecto, cortas, con el estado de su sesión: rama, card y cards mergeadas que aún no se han movido. La primera regla es que Karajan gobierna: un agente no cambia políticas, configuración de gates ni exclusiones para pasar un gate. Una sesión nueva no recibe nada extra, porque CLAUDE.md ya trae las reglas.

## governance

Karajan gobierna y se le obedece. Una sesión no cambia las reglas que la gobiernan: `.karajan/policy.yml`, `.karajan/kj.config.yml` y cualquier `.ragignore` son del humano, como los ficheros del propio supervisor, y Edit o Write sobre ellos se deniega antes de cualquier escape. Si un gate parece equivocado, el remedio es proponer el cambio al usuario o reportarlo con `kj report-issue`, nunca relajar la regla. Toda denegación del PreToolUse termina con la misma línea que lo dice.

## stop-gate

El turno no puede terminar mientras el método esté en rojo: suite fallando, diffs sin revisar, movimientos de board pendientes, afirmaciones sin respaldo. Resuelve las violaciones listadas o pide a tu usuario el escape aplicable. Estado: `kj sentinel status`.

## push-gate

Igual que el stop gate, en el momento del `git push`: nada sale de la máquina con el método en rojo.

## attribution

La atribución a IA está prohibida por una regla determinista del proyecto, en todas partes, sin escape. Tres capas la imponen: el hook commit-msg la rechaza en los mensajes de commit; el hook pre-commit escanea las líneas AÑADIDAS del diff staged (changelog, docs, comentarios de código, *mencionar* una herramienta sigue siendo legal, atribuir no); y el Sentinel escanea cada comando `gh` que publica texto (crear/editar/comentar/revisar PR/issue/release), incluido el contenido de `--body-file`/`--notes-file`, un fichero ilegible tampoco publica. El CI re-comprueba commits, cuerpo y título del PR. Nació de una pillada real: 15 cuerpos de PR llevaron un pie de atribución porque solo se escaneaban los mensajes de commit (KJC-BUG-0164).

## escapes

El ADR 0015 retira los escapes: un gate que necesita uno es un gate a corregir, y ningún escape lo puede activar el agente. Card-first, rag-first, board-sync y tests-con-código ya no tienen. Los demás, mientras sigan: un comando simple, un uso, registrado en el estado de la sesión y sellado en el acta de decisiones (`kj sentinel status` lista lo que esta sesión usó).

| Escape | Se salta | Legítimo cuando |
| --- | --- | --- |
| `KJ_ALLOW_CROSS_LANE=1` | guardas de cross-lane / ruta no verificable | Un cruce deliberado y anunciado (p.ej. publicar desde el worktree de un tag) |
| `KJ_ALLOW_IDENTITY=1` | bloqueo de identidad | Suites de test que ejercitan otras guardas; nunca para pushes reales |
| `KJ_ALLOW_POLICY=1` | denies de policy no-seguridad | La regla se dispara mal y el fix está acordado; el commit además necesita `KJ_POLICY_REASON` |
| `KJ_ALLOW_STEWARD=1` | bloqueo duro del steward | La rotura es conocida, cardeada, y el usuario dice que el trabajo continúa |
| `KJ_ALLOW_RELEASE=1` | release check | Un rojo que ahora mismo nadie puede arreglar, acordado con el humano (el caso de la landing lo cubre `remedied_by`) |
| `KJ_ALLOW_PII=1` | bloqueo de la denylist de privacidad en el commit | Un falso positivo confirmado, revisado por el humano |

No hay ningún `KJ_ALLOW_*` para los hallazgos de seguridad. Ese es el objetivo.
