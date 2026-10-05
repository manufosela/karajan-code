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

### 3. Seguridad máxima por defecto: lo peligroso se firma con el móvil

Decidido por el usuario el 2026-10-05. Hay dos niveles, y el de partida es el más alto:

- **Seguridad máxima (por defecto).** Todo comando del catálogo exige la firma del móvil sobre los bytes exactos de lo que se va a hacer. Sin móvil enrolado, el comando se niega y dice cómo enrolarlo; no hay degradación a solo-nonce.
- **Seguridad normal.** Las cuatro capas de ADR 0009, sin firma. kj dice en cada acto que la garantía es menor.

Bajar de máxima a normal es decisión del usuario y es, ella misma, un acto del catálogo: se firma con el móvil. Si no, el primero en bajarla sería el agente. Subir de normal a máxima no necesita firma.

El par de claves del móvil hoy se crea con un comando aparte y opcional (`kj identity enroll-phone`). Con la máxima por defecto, enrolar el móvil pasa a formar parte de la instalación: `kj init` lo ofrece como paso del arranque y explica para qué sirve. Quien lo salte queda sin poder ejecutar los comandos del catálogo hasta que lo enrole o baje el nivel.

Cada petición de firma dice, en el terminal y en la pantalla del móvil, qué se va a hacer, por qué se pide la firma y qué pasaría si la hiciera otro en su nombre. La fricción es mayor, pero estos actos son raros: sellar el supervisor tras cambiar el arnés, aprobar reglas, ejecutar un encargo. No son parte del trabajo de cada día.

### Lo rutinario no necesita encargo

Para lo que se repite, kj ofrece verbos seguros propios (por ejemplo, limpiar stashes enseñando qué borra y guardando copia antes). Menos peticiones al humano son menos ocasiones de engaño.

## Consequences

- Más fricción en cada acto peligroso: sacar el móvil. Es el precio de que la prueba no dependa de la máquina donde corre el agente.
- La opinión de la segunda IA cuesta tokens y reduce el riesgo, no lo elimina. Lo que lo acota de verdad no depende de ningún modelo: el porqué escrito por kj, los datos de lo que se toca y la ejecución por identificador.
- Quien no enrole el móvil no ejecuta lo peligroso hasta que lo haga o baje el nivel a conciencia. Arrancar es más áspero; a cambio, nadie trabaja con una garantía menor sin haberlo elegido.
- Perder el móvil deja al usuario sin poder firmar. Hace falta un camino de recuperación (un segundo firmante en el padrón) antes de que la máxima sea el defecto. Pendiente de diseñar.
- `kj rules approve` (ADR 0016) pasa a exigir la firma, como el sello.

Alternativas descartadas:

- Dejarlo como está y confiar en la explicación del agente: es justo lo que no se puede comprobar.
- Solo la opinión de otra IA, sin canal: el humano seguiría copiando un comando que nadie ató a esa opinión.
- Firma del móvil para todo comando de kj: la fricción haría que se enrolase menos gente. Se reserva a lo peligroso.
- Seguridad normal por defecto, con la máxima como opción: quien no sabe que existe el riesgo nunca la activaría. El defecto protege a quien menos sabe.
