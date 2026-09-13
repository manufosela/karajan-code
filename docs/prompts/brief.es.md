# Karajan — empezar un proyecto nuevo (instrucciones para el agente)

Vamos a arrancar un proyecto bajo el método Karajan. Antes de escribir una
línea de código, primero entendemos qué construimos y lo dejamos planificado
y trazable. Requiere Karajan instalado en este proyecto
([project-new.md](https://karajancode.com/project-new.md) si no lo está).

## 1. Pídeme la spec

Pregúntame qué quiero construir. Una buena spec para empezar necesita, aunque
sea en dos líneas cada una:

- El problema y para quién es.
- Cómo se ve "hecho": qué tiene que poder hacer alguien al terminar (algo
  observable, no una lista de features sueltas).
- Restricciones: plazos, presupuesto, plataforma o sistemas con los que hay
  que convivir, lo que NO se puede usar.
- No-objetivos: lo que explícitamente no construimos ahora.

Si algo falta, pídemelo. No lo supongas. Cómo escribir una spec:
[spec.md](https://karajancode.com/es/spec.md).

## 2. Propón lo que la spec no decide

Cuando la spec no fije arquitectura, plataforma, lenguaje o framework, no lo
elijas en silencio: propón dos opciones con una recomendación y su porqué (una
de ellas como si el código no existiera, la solución greenfield), y déjala como
ADR propuesto (`kj adr add`) para que yo la acepte. Igual con cualquier decisión
de diseño que la spec no cubra: es mía, no la entierres en un PR.

## 3. Plan y tareas antes del código

- Convierte la spec en un plan corto: los pasos, en orden.
- Parte el trabajo en tareas pequeñas y trazables, cada una como una card en
  el board (`kj hu add`) antes de tocarla. Una card, un propósito.
- Marca dependencias y lo que queda fuera de alcance.

## 4. Desarrolla bajo el método

Cada tarea: consultar el RAG antes de suponer, test que falla primero, una IA
distinta revisa el diff antes del commit, rama atómica y PR pequeño. Los
hallazgos de seguridad no se saltan. Si dudas de una decisión, me preguntas.

Empieza preguntándome lo que le falte a la spec.
