# El cauce sancionado del supervisor: como se versiona lo que kj harden regenera

Status: accepted
Date: 2026-09-06
Accepted: 2026-09-06 (dev_001) — opcion A

## Context

Los git hooks del proyecto (.karajan/hooks/commit-msg, pre-commit, pre-push) estan TRACKEADOS en el repo y a la vez son ficheros del supervisor: defaults.supervisor.write (clase security, inexcepcionable) prohibe que una sesion de IA los toque, y el MISMO motor corre en la review local y en el check --strict del CI. Consecuencia medida (KJC-BUG-0161, 6-sep): kj harden los regenera legitimamente (rebrand de mensajes de 0814, guard branch-first, chaining del hook global), pero NO existe camino por el que esa regeneracion llegue a main — ni la IA (denegada, correcto) ni el humano via PR (el CI la deniega igual). El drift es permanente: la copia versionada lleva sin actualizarse desde antes de que existiera la clase security, y hoy miente sobre lo que el supervisor ES. Los hooks ACTIVOS (los del arbol, via core.hooksPath) si estan al dia — lo roto es solo la copia versionada.

## Options

A) kj harden --commit (accion humana sellada): cuando el HUMANO ejecuta kj harden, una flag nueva commitea los ficheros regenerados en un commit que solo los contiene a ellos, y sella en el decision log la procedencia: "regenerado por kj harden vX.Y.Z, sin edicion manual, hash H de cada fichero". Review local y CI ganan UNA exencion estructural estrecha: aceptan un diff de supervisor SI Y SOLO SI el contenido coincide byte a byte con lo que el kj de esa version genera (verificable recomputando las plantillas, como ya hace el tamper check) y el sello existe. Un diff de supervisor con una coma manual sigue denegado.
   - Ventaja: un clon fresco trae los gates activos desde el primer segundo (core.hooksPath apunta a ficheros versionados). La copia versionada vuelve a ser verdad.
   - Coste: la exencion estructural es superficie nueva del gate (aunque estrecha y deterministica); ~80-120 LOC entre harden, review-gate y CI.

B) Dejar de versionarlos (verificacion por huella): los hooks salen del repo (git rm + .gitignore); la unica copia es la que kj harden escribe, y la integridad la garantiza el tamper check existente (comparar contra lo que el kj instalado generaria). El repo documenta que `kj harden` es paso obligatorio post-clone.
   - Ventaja: desaparece la clase entera del problema — no hay copia que pueda mentir ni drift posible; cero superficie nueva en los gates.
   - Coste: un clon fresco NO tiene gates hasta correr kj harden (ventana sin proteccion en maquinas nuevas; mitigable porque kj env install/go ya lo hacen, pero un git clone + commit manual directo quedaria sin guardas). Y borrar los hooks del repo es en si mismo un diff de supervisor: la transicion necesita el mismo tipo de acto humano sellado que A.

C) Status quo documentado: aceptar el drift permanente y documentar que la copia versionada es historica.
   - Descartable: un repo que versiona una mentira contradice el principio de evidencia del metodo.

## Decision (propuesta, pendiente del usuario)

A. La copia versionada tiene valor real (gates activos en cada clon desde el segundo cero — exactamente la promesa del harden) y la exencion estructural de A es deterministica y estrecha: no confia en nadie, recomputa. B queda como simplificacion futura si la familia decide que kj harden post-clone es contrato suficiente.

## Consequences

Precision de implementacion (al aceptar): la recomputacion byte a byte solo es posible EN LA MAQUINA que corre kj harden — la generacion esta parametrizada (comandos nativos del stack, rama base, chaining del hook global). Por eso el contrato es: en local, kj harden --commit recomputa (trivial: lo que acaba de escribir ES lo canonico) y sella en el decision log la version de kj y el hash sha256 de cada fichero; los gates (review local y CI) verifican que cada fichero de supervisor tocado coincide con un hash sellado en el log Y que la cadena del log esta integra. La confianza se apoya en la raiz que ya existe (el acta hash-encadenada), no en poder regenerar en CI. Requisito previo: las plantillas no hornean rutas de maquina (chaining via $HOME — mismo contenido en todas partes).

kj harden gana --commit (solo con TTY humano, jamas desde una sesion con CLAUDECODE/agente detectado); el decision log gana el sello de procedencia del supervisor; review-gate y kj-policy CI ganan la verificacion por recomputacion; KJC-BUG-0161 se implementa sobre esta decision. Los 3 ficheros hoy en drift serian el primer uso real del cauce.
