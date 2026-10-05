# Lo que el agente pide al humano pasa por kj y lo peligroso se firma

Status: proposed
Date: 2026-10-05

## Context

Karajan quiere que alguien sin oficio (un maggle) cree aplicaciones con garantías. Hoy, cuando kj le impide algo al agente, el agente se lo pide al humano por el chat: «ejecuta esto tú». Ahí hay tres huecos:

- El porqué lo cuenta el mismo agente que pide. El humano no puede saber si es verdad.
- El comando lo copia el humano a mano. El agente puede explicar una cosa y dar otra.
- Lo que hace de un comando un acto humano (ADR 0009) son, salvo en el sello del supervisor, cuatro capas que disuaden pero no prueban: entorno y terminal, ascendencia de procesos y un nonce tecleado. Un agente externo con un driver de terminal podría pasarlas. Solo la firma del móvil (capa 5, KJC-TSK-0822) es una prueba: la clave privada no está en la máquina. Hoy solo la exige `kj harden --commit`.

A la vez hay cosas rutinarias que no se pueden dejar de hacer, como limpiar stashes, y que hoy acaban también en «hazlo tú».

Principio del usuario: no fiarse ni de su padre. Todo comprobado y contrastado.

## Decision

PROPUESTA, pendiente del usuario. Tres piezas.

### 1. El encargo al humano pasa por kj

- El agente no pide por el chat: registra un encargo (`kj handoff`) con el comando exacto.
- El porqué lo escribe kj a partir de lo que tiene registrado (qué gate bloqueó y por qué), no el agente.
- kj dice qué va a pasar con datos, sin modelo: qué toca, si se puede deshacer, y el contenido afectado (para un stash, cuáles hay y qué llevan).
- Una IA distinta de la que pide opina del riesgo: qué habilita y qué puede romper.
- El humano ejecuta el encargo por su identificador, no el texto: kj lanza exactamente los bytes revisados. No hay copiar y pegar.

### 2. Un catálogo de comandos peligrosos, y un solo mecanismo

Todo comando de kj destructivo o que cambie quién gobierna entra en un catálogo cerrado: sellar el supervisor, aprobar reglas, ejecutar un encargo, enrolar el móvil, y los que se añadan. Todos pasan por el mismo módulo (`src/harden/human-act.js`). Un test de arquitectura falla si un comando del catálogo no lo usa, y si aparece un comando destructivo fuera del catálogo.

### 3. Lo peligroso se firma con el móvil

Con móvil enrolado, todo comando del catálogo exige la firma del móvil sobre los bytes exactos de lo que se va a hacer, y nunca se degrada a solo-nonce. Sin móvil enrolado se aplican las cuatro capas y kj dice, cada vez, que la garantía es menor y cómo enrolarlo.

### Lo rutinario no necesita encargo

Para lo que se repite, kj ofrece verbos seguros propios (por ejemplo, limpiar stashes enseñando qué borra y guardando copia antes). Menos peticiones al humano son menos ocasiones de engaño.

## Consequences

- Más fricción en cada acto peligroso: sacar el móvil. Es el precio de que la prueba no dependa de la máquina donde corre el agente.
- La opinión de la segunda IA cuesta tokens y reduce el riesgo, no lo elimina. Lo que lo acota de verdad no depende de ningún modelo: el porqué escrito por kj, los datos de lo que se toca y la ejecución por identificador.
- Quien no enrole el móvil trabaja con una garantía menor, y kj se lo dice en vez de callarlo.
- `kj rules approve` (ADR 0016) pasa a exigir la firma, como el sello.

Alternativas descartadas:

- Dejarlo como está y confiar en la explicación del agente: es justo lo que no se puede comprobar.
- Solo la opinión de otra IA, sin canal: el humano seguiría copiando un comando que nadie ató a esa opinión.
- Firma del móvil para todo comando de kj: la fricción haría que se enrolase menos gente. Se reserva a lo peligroso.
