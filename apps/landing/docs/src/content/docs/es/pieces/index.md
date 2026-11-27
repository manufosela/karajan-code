---
title: Las piezas de Karajan
description: Cada pieza de Karajan explicada para personas. Qué es, por qué existe, cuándo actúa, cómo se usa y qué no hace.
---

Karajan está hecho de unas pocas piezas. Cada una responde a una sola pregunta sobre el trabajo que hace tu agente. Esta sección las explica de una en una, para personas: qué es cada pieza, por qué existe, cuándo actúa, cómo se usa y qué no hace.

Las guías técnicas (la [guía del Sentinel](/docs/es/guides/sentinel/), [los gates](/docs/es/v4/gates/)) recogen cada mensaje y cada regla. Léelas cuando un gate te pare. Lee esta sección para entender por qué está ahí.

## Quién hace qué

Intervienen tres actores, y cada pieza es de uno de ellos:

| Actor | Qué hace |
|---|---|
| **Tu agente** (Claude Code, Codex, Gemini CLI) | Escribe el código y ejecuta los comandos. |
| **kj** | Comprueba el método con código determinista, en la sesión y en git. Nunca le pregunta a un modelo si se ha seguido el método. |
| **Tú** | Decides lo que es del proyecto: las reglas, el sello, las releases, las excepciones. |

## Las piezas a lo largo de una tarea

Una tarea pasa siempre por los mismos momentos. Esto es lo que actúa en cada uno:

| Momento | Pieza | Qué comprueba |
|---|---|---|
| La sesión se compacta o se reanuda | [El Sentinel](/docs/es/pieces/sentinel/) | Le devuelve al agente las reglas que leyó al empezar. |
| Antes de cualquier trabajo | [El board](/docs/es/guides/hu-board/) | El trabajo tiene card, y la rama la nombra. |
| Antes de tocar código | [El RAG del proyecto](/docs/es/karagan/) | El agente ha preguntado al índice del proyecto por esa zona, en vez de suponer. |
| En cada llamada a una herramienta | [El Sentinel](/docs/es/pieces/sentinel/) | Nada de editar en la rama base ni en otro carril, ninguna regla rota, nada escrito a sus espaldas. |
| En cada llamada, cuando ya ha terminado | [El ledger](/docs/es/pieces/ledger/) | Apunta lo que ha hecho la sesión: consultas, ficheros editados, cards mergeadas. |
| Antes de la revisión | [Calidad antes de la revisión](/docs/es/pieces/quality/) | Los tests del propio diff pasan, ningún test se ha debilitado, Sonar no ha encontrado nada grave. |
| Antes del commit | [La revisión cruzada](/docs/es/pieces/cross-review/) | Otra IA, distinta, ha aprobado exactamente este diff. |
| El commit y la pull request | Los hooks de git y el CI | El veredicto está y corresponde al diff. Sin kj los hooks de git no corren; el CI sí. |
| Al terminar el turno | [El Sentinel](/docs/es/pieces/sentinel/) | El agente no se para con el método en rojo ni con sus cards a medias. |
| Cada semana, o cuando lo pides | [El Steward](/docs/es/pieces/steward/) | El proyecto sigue sano: dependencias, el CI de main, invariantes. |
| Lo que solo puedes hacer tú | [Los actos humanos](/docs/es/guides/hardening-against-ai/) | El sello, la aprobación de una release y las excepciones las teclea una persona, nunca el agente. |

## La idea detrás de todas

Un agente olvida. Olvida las reglas tras una compactación, olvida que se saltó un test y te dice que ha ejecutado algo que no ha ejecutado. Pedirle que se acuerde no funciona, porque quien tiene que acordarse es quien lo olvidó.

Por eso cada pieza de Karajan cambia un recuerdo por un mecanismo: una comprobación que corre sola, en el momento justo, con la misma respuesta cada vez. Donde una regla era una opinión ("creo que la he seguido"), hay un hecho ("el fichero lo dice, o no lo dice").
