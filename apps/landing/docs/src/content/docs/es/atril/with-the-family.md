---
title: 'Con la familia'
description: 'Cómo usa atril Karajan Code: kj init instala sus comandos en .karajan/, el puente /atril, atril sync, y qué aportan kaRAGan y el HU board alrededor.'
---

atril funciona por sí solo (mira la [visión general](../overview/)). Karajan Code depende de él y lo usa como almacén de sus propios comandos.

## Qué hace `kj init`

`kj init` instala los comandos `kj-*` de Karajan en el store de atril, bajo `.karajan/` (`.karajan/commands/`), **bajo demanda**: no se copian a `.claude/commands/` ni a la carpeta de ningún otro CLI, así que no ocupan contexto hasta que un agente los pide. Si lo ejecutas dos veces, el store no cambia (`unchanged`).

## El puente `/atril`

Los CLI solo aceptan los comandos slash que conocen. atril registra uno solo en cada CLI, el puente `/atril <nombre o tarea>`, más una regla de enrutado que le dice al agente que consulte a atril antes de empezar una tarea. Los comandos de Karajan, y todo lo demás que haya en el store, se alcanzan a través de ese puente.

## `atril sync` desde kj

Si el proyecto ya usa [rulesync](../integrations/), `kj init` ejecuta por ti `atril sync --root .karajan`: escribe el puente y la regla de enrutado en `.rulesync/` y, si `.karajan/atril.json` declara `rulesync.generate: true`, genera los ficheros para cada CLI. Sin rulesync, kj instala los comandos, te dice que ejecutes `rulesync init` y después `atril sync --root .karajan`, y se detiene ahí: no escribe nada persistente.

## Qué aportan kaRAGan y el HU board

- [kaRAGan](../../karagan/) indexa el proyecto, así que un agente responde con `kj rag query` en vez de adivinar qué hace el código.
- El HU board (`kj hu`) guarda las tarjetas a las que pertenece cada trabajo.

atril decide **qué** comando o regla llega al agente; kaRAGan y el board deciden **qué** sabe el agente y **en qué** está trabajando.
