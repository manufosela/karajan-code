# Composicion de autorizaciones: cuando dos excepciones legitimas juntas son una brecha

Status: proposed
Date: 2026-08-21

## Context

GOV-B (ADR 0003) modela la excepcion como objeto de primera clase: quien, regla exacta, justificacion, caducidad. El gate (evaluateGate) comprueba cada violacion enforcement=deny contra las excepciones permanentes VIVAS de ESA regla, una a una. Lo que no mira es la composicion: dos concesiones legitimas por separado pueden, juntas, abrir un camino que ninguna regla quiso permitir (ejemplo: excepcion de escritura sobre los templates del harness + excepcion de shell sobre git push = editar el supervisor y empujarlo sin pasar por el gate que lo vigila). La clase security ya es inexcepcionable y tapa los peores casos (defaults.supervisor.*); el riesgo de composicion vive entre las reglas NO-security. Es la idea de fondo del hilo con Guillermo Vallejo (ago-2026): "el problema aparece en la composicion de permisos". Hoy evaluateGate recibe standingExceptions como entrada pero no razona sobre pares ni conjuntos, y kj policy grant no sabe que existe el resto de concesiones.

## Options

A) Status quo + informe. kj policy report (PL-E) lista las concesiones vivas; un humano revisa la composicion. Coste cero; garantia cero: el mismo tipo de regla-en-memoria que el identity lock vino a matar.

B) Invariantes de composicion en policy.yml (vocabulario v2, cerrado y fail-loud):

    invariants:
      - id: no-edit-and-ship
        kind: grant-composition
        forbid: [roles.coder.write.deny, roles.coder.shell.deny]
        enforcement: deny

   Semantica: un conjunto prohibido de rule_ids. En tiempo de CONCESION, kj policy grant rechaza la concesion que completaria un conjunto prohibido con las permanentes vivas (nombrando cuales). En tiempo de GATE, las permanentes vivas que forman un conjunto prohibido se consideran SUSPENDIDAS (ninguna exime; la denegacion nombra el invariante y las concesiones implicadas). Un invariante que cite una regla inexistente es error de carga, jamas regla muerta. La evaluacion es sobre las permanentes vivas del repo sin distinguir identidad: dos personas con una concesion cada una componen igual en el mismo arbol.

C) Greenfield, como si GOV-B no existiera: modelo de capacidades. La concesion no es "eximir una regla" sino un token de capacidad con alcance explicito (ficheros + comandos + ttl); el kernel calcula el conjunto efectivo de capacidades por identidad y lo contrasta con conjunciones prohibidas declaradas por el consumidor. Semantica mas limpia y composicion nativa, pero re-modela la excepcion entera, rompe el formato del jsonl (historia append-only de GOV-B/GOV-C) y duplica el vocabulario de roles.*.write/shell.

## Decision (propuesta, pendiente del usuario)

B. Encaja en el kernel existente (evaluateGate gana compositionRules; el adaptador de grant consulta las vivas antes de registrar), mantiene el formato probatorio y el log encadenado intactos, y es determinista y local. C queda como direccion de 1.0 del kernel si la familia necesita mas de un dominio con capacidades heterogeneas.

Migracion: al aterrizar un invariante, las concesiones vivas que ya formen un conjunto prohibido quedan SUSPENDIDAS (no borradas: el log es append-only); kj policy report las lista en una seccion "composiciones" con el invariante que las suspende y el remedio (dejar caducar una, o cambiar la politica por su cauce).

## Consequences

Vocabulario v2 de policy.yml (kind: grant-composition). kj policy grant necesita leer las permanentes vivas (ya lo hace para el contador de renovaciones). evaluateGate recibe un parametro mas y su resultado gana suspended[]. El sello de decision (GOV-C) registra la suspension con el invariante. La clase security sigue fuera: ya es inexcepcionable, no compone.

## Preguntas abiertas para decidir juntos

1. Alcance de identidad: conjunto prohibido sobre TODAS las vivas del repo (propuesto) o solo sobre las de la misma identidad.
2. Quien declara los conjuntos por defecto: el consumidor (karajan-code trae uno o dos, como los defaults.supervisor) o solo el proyecto en su policy.yml.
3. Suspension vs. revocacion: suspender preserva la historia y se autorresuelve al caducar una; revocar exigiria un nuevo tipo de registro.
