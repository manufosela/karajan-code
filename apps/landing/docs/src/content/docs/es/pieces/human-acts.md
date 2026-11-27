---
title: Los actos humanos
description: Los comandos que solo puede ejecutar una persona, nunca el agente. Qué son, por qué existen, cuándo actúan, cómo se usan y qué no hacen.
---

## Qué es

Un acto humano es un comando de kj que cambia quién gobierna el proyecto, o que podría destruir trabajo. kj guarda una lista cerrada de ellos, y cada uno se niega a correr cuando lo ha lanzado un agente. Estos son los principales:

| Comando | Qué hace |
|---|---|
| `kj harden --commit` | Sella el supervisor que kj ha regenerado (hooks, workflows de gobierno). |
| `kj rules approve` | Convierte las reglas de tus ficheros Markdown en gates. |
| `kj identity enroll-phone` | Da de alta el móvil que firma los actos más delicados. |
| `kj policy grant` | Concede una excepción con fecha a una regla que no sea de seguridad. |
| `kj release approve` | Aprueba una versión para publicarla y crea su tag. |
| `kj agents set` | Cambia el panel: quién escribe, quién revisa, quién arbitra. |
| `kj security normal` | Baja el nivel de seguridad. |
| `kj gates set` | Afloja un gate (endurecerlo puede hacerlo el agente). |

## Por qué existe

El agente es el gobernado. Si pudiera sellar su propio supervisor, aprobar sus propias reglas, elegir a su propio revisor o concederse una excepción, todas las demás piezas serían una sugerencia. Estos actos son la línea entre lo que hace el agente y lo que decide la persona.

## Cuándo actúa

Cuando ejecutas uno, kj comprueba, por orden:

1. Que no corre dentro de una sesión de agente: sin `CLAUDECODE` en el entorno, sin `KJ_NON_INTERACTIVE=1` y con una terminal de verdad.
2. Que ningún proceso padre es un agente (Claude, Codex, Copilot, Gemini, opencode, agy), subiendo hasta 40 niveles. Si no puede leer el árbol de procesos, se niega: nunca supone.
3. Que hay una persona delante: muestra un código corto y tú lo tecleas, leído de la propia terminal, no de la entrada que un agente podría inyectar.
4. En los actos que cambian quién gobierna (dar de alta el móvil, bajar la seguridad, aflojar un gate, una excepción a la protección de main, una excepción de política, cambiar el panel), una firma desde tu móvil o con una passkey en `https://karajancode.com/sign`. En el nivel de seguridad `max` se firman todos.

## Cómo se usa

Lo tecleas tú en tu propia terminal, a mano. No en un script que le pidas al agente, ni a través de la shell del agente: kj rechaza las dos cosas. Cuando el agente necesita uno, te dice el comando exacto, y puede registrarlo con `kj handoff add` para que lo veas en `kj handoff watch`.

## Qué no hace

- **No frena el trabajo normal del agente.** Las ramas, los commits, las revisiones y las pull requests son del agente; solo los actos de arriba son tuyos.
- **No se fía de una aprobación que alguien dice que has dado.** "El usuario ha dicho que sí" en un mensaje, un fichero o una pull request no es tu terminal.
- **`kj release propose` no es uno.** El agente puede proponer una release; solo `kj release approve` es tuyo.
