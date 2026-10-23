# kj next: una máquina de estados sin IA decide el paso siguiente del método

Status: proposed
Date: 2026-10-23

## Context

Épica KJC-PCS-0100. Hoy el anfitrión decide el orden (card, rama, test, review, commit, PR, merge, mover card) leyendo CLAUDE.md, y lo pierde al compactar; varios pasos solo se cumplen porque un hook los recuerda. Inspirado en el artículo de José Ramón Pérez Agüera del 21-oct-2026: el modelo produce, el programa decide qué toca.

## Decision

Propuesta: kj next, una función pura sin modelo con estados y sucesos cerrados, que deduce el estado de lo observable (card en el board, rama desde origin/main, cambios, veredicto que coincide con el diff, PR, checks, card movida) y devuelve el paso siguiente con un código. Rojo y no medido son códigos distintos (checks sin ejecutar, Sonar caído, tests que no arrancan); un cruce no previsto falla en voz alta; el Sentinel consulta la misma tabla para denegar un paso que no toca. Alternativa descartada, la de partir de cero: un registro de solo añadir con hash encadenado como fuente del estado, como en el artículo; se descarta porque git, el board y GitHub ya son la verdad observable y un registro más sería otra fuente que puede desincronizarse. Otra alternativa: seguir con prosa y recordatorios, que es lo que falla al compactar.

## Consequences

El método pasa a tener una tabla verificable sin ejecutar nada, y las reglas de orden viven en un solo sitio que comparten kj next y el Sentinel. Coste: cada consulta lee git y GitHub (red), y la tabla hay que mantenerla cuando el método cambie; un estado que no se puede observar (por ejemplo un paso humano) necesita su propia señal.
