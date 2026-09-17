# El RAG como gate: la sesion no toca lo que no ha consultado

Status: proposed
Date: 2026-09-17

## Context

El playbook dice «el RAG responde antes de que asumas» y es la primera invariante del metodo. Pero es texto: nada impide que una sesion vaya a grep, lea dos ficheros y edite. El 16-sep-2026 salieron cinco bugs de campo en un dia con el MISMO patron, y ninguno era un error de logica: el mismo concepto vive en varios sitios y el cambio llego solo a algunos.

- KJC-BUG-0175: el schema de siete tools MCP prometia `task` o `taskFile`; solo `kj_run` leia el fichero. Siete bloques copiados a mano.
- KJC-BUG-0176: `kjHome` se cableo cuando todo iba por subproceso; cuando los handlers pasaron a correr en proceso, el parametro quedo a medio cablear.
- KJC-BUG-0177: la CLI gano aislamiento por proyecto en el RAG (KJC-TSK-0438); el handler MCP, entrada paralela a la misma funcion, no.
- KJC-BUG-0179: el runtime migro `KJ_HOME` a `KARAJAN_HOME`; el instalador (`scripts/postinstall.js`) no. Ese fichero estaba fuera de Sonar y fuera de cualquier auditoria.
- KRD-BUG-0002: los tests sembraban filas con los nombres que el codigo esperaba, no la fila real que siembra la migracion.

En los cuatro casos de kj, una consulta al RAG sobre el concepto («donde se lee KJ_HOME», «que entradas llaman a query()») habria devuelto el gemelo que no se toco. La sesion que arreglo los bugs tampoco consulto el RAG: fue a grep. La leccion de Sonar (v3 -> v4) se repite: una regla que no es gate se salta, aunque este en la primera linea del playbook.

## Options

A) Gate de sesion: el Sentinel deniega el primer Edit/Write de una fuente si la sesion no ha hecho NINGUNA consulta RAG. Una consulta cualquiera desbloquea todo.
   - Ventaja: trivial (mismo patron que card-first), cero falsos bloqueos.
   - Coste: no dice nada del fichero tocado; una consulta ritual al abrir la sesion lo vacia de contenido. Es la version debil de la regla que ya se incumple.

B) Gate por fichero con ledger de hits: cada consulta (CLI `kj rag query` y MCP `kj_rag_query`) registra en el estado de sesion del harness las rutas de los hits devueltos. El Sentinel deniega Edit/Write de una fuente que ninguna consulta de la sesion devolvio, ni a ella ni a un fichero de su directorio; un fichero nuevo exige una consulta previa sobre su directorio. `KJ_ALLOW_NO_RAG=1` es la excepcion consciente, sellada en el decision log. Docs y config quedan fuera (el mismo conjunto que card-first).
   - Ventaja: el gate afirma algo concreto y verificable («el RAG respondio sobre ESTA zona antes de tocarla»), determinista, sin LLM. Y como el ledger guarda TODOS los hits, no solo el fichero editado, los gemelos devueltos y no tocados quedan a la vista.
   - Coste: depende de que el indice cubra el repo entero (hoy `scripts/` y `bin/` no estan ni en Sonar); ~150 LOC entre ledger, Sentinel y tests; algun falso bloqueo cuando el RAG no devuelve un fichero que si es relevante (mitigado por el hermano de directorio y por el escape sellado).

C) Evidencia en el veredicto (como si el codigo no existiera): la consulta al RAG no se exige al editar sino al revisar. `kj review --staged` calcula desde el ledger un bloque `rag {queries, covered, uncovered, twinsUntouched}` atado al diffHash, exactamente como el bloque `sonar`; el reviewer cruzado recibe los gemelos sin tocar como advisory nominal («el RAG devolvio tambien estos ficheros para el mismo concepto y no estan en el diff»); `--check` rechaza un veredicto de codigo sin bloque rag; la unica excepcion es un grant humano `method.rag.code`. `kj check` y el informe del metodo ponen el metodo en rojo con veredictos de codigo sin evidencia RAG.
   - Ventaja: ataca directamente la clase de bug (el gemelo olvidado se nombra al revisor, que es quien puede exigirlo); reutiliza la infraestructura probada del bloque sonar y del grant humano; la evidencia queda en el registro, auditable.
   - Coste: llega tarde para el que edita (se entera al revisar, no al tocar); necesita el ledger de B de todos modos.

D) Status quo: la regla sigue en el playbook y en los briefs.
   - Descartable por la evidencia del 16-sep: ya estaba en el playbook cuando salieron los cinco bugs.

## Decision (propuesta, pendiente del usuario)

B + C, sobre un ledger comun: el gate del Sentinel (B) para que el agente consulte ANTES de tocar, y la evidencia en el veredicto (C) para que el revisor vea los gemelos y el pre-commit no deje pasar codigo hecho a ciegas. A queda como fallback para ficheros nuevos dentro de B. Precondicion no negociable: cobertura del indice como defecto (RAG-D): `scripts/`, `bin/` y `packages/*/src` indexados por defecto, y `kj check` marca en rojo cualquier fuente del repo fuera del indice o mas vieja que su ultimo commit, con la misma semantica que la cobertura probada de Sonar. Un gate que no ve el fichero no protege nada.

## Consequences

Cuatro cards en la epica KJC-PCS-0086: RAG-A ledger (KJC-TSK-0847), RAG-B gate del Sentinel (0848), RAG-C bloque rag en el veredicto y --check (0849), RAG-D cobertura del indice como defecto (0850). Todas bloqueadas por esta decision. Coste aceptado: una consulta RAG obligatoria por zona tocada (segundos, cero tokens del reviewer) y un escape mas en la tabla del Sentinel, documentado en la pagina de gates. Lo que NO cambia: el RAG sigue siendo local y determinista; el gate no llama a ningun LLM; docs y config siguen fuera. Riesgo residual honesto: el agente puede hacer una consulta irrelevante que devuelva el fichero por casualidad; el bloque rag del veredicto deja la consulta escrita, y el revisor (o el humano) puede juzgarla.
