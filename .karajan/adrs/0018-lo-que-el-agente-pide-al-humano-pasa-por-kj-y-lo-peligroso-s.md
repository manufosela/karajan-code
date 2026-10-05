# Lo que el agente pide al humano pasa por kj y lo peligroso se firma

Status: accepted
Date: 2026-10-05

## Context

Karajan quiere que alguien sin oficio (un maggle) cree aplicaciones con garantías. Hoy, cuando kj le impide algo al agente, el agente se lo pide al humano por el chat: «ejecuta esto tú». Ahí hay tres huecos:

- El porqué lo cuenta el mismo agente que pide. El humano no puede saber si es verdad.
- El comando lo copia el humano a mano. El agente puede explicar una cosa y dar otra.
- Lo que hace de un comando un acto humano (ADR 0009) son, salvo en el sello del supervisor, cuatro capas que disuaden pero no prueban: entorno y terminal, ascendencia de procesos y un nonce tecleado. Un agente externo con un driver de terminal podría pasarlas. Solo la firma del móvil (capa 5, KJC-TSK-0822) es una prueba: la clave privada no está en la máquina. Hoy solo la exige `kj harden --commit`.

A la vez hay cosas rutinarias que no se pueden dejar de hacer, como limpiar stashes, y que hoy acaban también en «hazlo tú».

Principio del usuario: no fiarse ni de su padre. Todo comprobado y contrastado.

## Decision

Aceptada por el usuario el 2026-10-05. Cinco piezas.

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

### 4. La garantía vive fuera de la máquina

Pregunta del usuario: si borro todo rastro de Karajan del proyecto, o lo reinstalo, ¿desaparece la restricción? En la máquina, sí: quien puede borrar ficheros puede borrar al guardián, y eso vale igual para un agente externo. Ninguna comprobación local resiste a quien controla el disco.

Por eso lo que cuenta es lo que se verifica fuera: el padrón de firmantes (`.karajan/supervisor-signers.json`) viaja con el repo y CI comprueba contra él. Borrar o reinstalar Karajan en local no cambia lo que CI exige para aceptar un cambio en `main`.

Estado real a 2026-10-05, comprobado en el código: la firma del móvil se verifica solo en la máquina, al firmar. CI comprueba los hashes de la procedencia, pero no la firma contra el padrón. Hasta que eso exista, la firma no añade nada que un borrado local no deshaga. Es parte de esta decisión:

- CI verifica la firma de cada acto del catálogo contra el padrón versionado.
- Un cambio en el padrón (alta, baja, sustitución de una clave) solo lo acepta CI si viene firmado por un firmante ya presente o respaldado por el código de recuperación.
- Un proyecto sin CI tiene solo la garantía local, y kj lo dice: protege de descuidos, no de quien controla la máquina.

### 5. Recuperación con código, no con reinstalación

Perder el móvil no puede resolverse reinstalando, porque entonces reinstalar sería también el camino del atacante. La recuperación es un código:

- Se genera al enrolar el móvil, en el terminal del usuario, fuera de toda sesión de agente, y el alta se firma con el móvil.
- Se enseña una sola vez. El usuario lo guarda fuera de la máquina. En el padrón queda solo su huella, nunca el código.
- Sirve para una cosa: enrolar un móvil nuevo. CI acepta ese cambio del padrón porque la huella coincide.
- Es de un solo uso: al usarlo se genera otro.

Sin móvil y sin código no hay recuperación dentro del sistema: el dueño del repositorio tendría que rehacer el padrón por fuera de CI, a la vista de todos en el historial. Es deliberado: un camino de recuperación que no exige nada es una puerta.

### Lo rutinario no necesita encargo

Para lo que se repite, kj ofrece verbos seguros propios (por ejemplo, limpiar stashes enseñando qué borra y guardando copia antes). Menos peticiones al humano son menos ocasiones de engaño.

## Consequences

- Más fricción en cada acto peligroso: sacar el móvil. Es el precio de que la prueba no dependa de la máquina donde corre el agente.
- La opinión de la segunda IA cuesta tokens y reduce el riesgo, no lo elimina. Lo que lo acota de verdad no depende de ningún modelo: el porqué escrito por kj, los datos de lo que se toca y la ejecución por identificador.
- Quien no enrole el móvil no ejecuta lo peligroso hasta que lo haga o baje el nivel a conciencia. Arrancar es más áspero; a cambio, nadie trabaja con una garantía menor sin haberlo elegido.
- Perder el móvil y el código de recuperación a la vez deja al usuario fuera. Guardar el código es responsabilidad suya, y kj se lo dice al dárselo.
- La seguridad máxima no puede ser el defecto hasta que CI verifique la firma y exista el código de recuperación: antes sería fricción sin garantía.
- `kj rules approve` (ADR 0016) pasa a exigir la firma, como el sello.

Alternativas descartadas:

- Dejarlo como está y confiar en la explicación del agente: es justo lo que no se puede comprobar.
- Solo la opinión de otra IA, sin canal: el humano seguiría copiando un comando que nadie ató a esa opinión.
- Firma del móvil para todo comando de kj: la fricción haría que se enrolase menos gente. Se reserva a lo peligroso.
- Seguridad normal por defecto, con la máxima como opción: quien no sabe que existe el riesgo nunca la activaría. El defecto protege a quien menos sabe.
