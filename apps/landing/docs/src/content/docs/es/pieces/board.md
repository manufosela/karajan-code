---
title: El board y las cards
description: Todo trabajo tiene card antes de empezar, y la rama la nombra. Qué es, por qué existe, cuándo actúa, cómo se usa y qué no hace.
---

## Qué es

Una card es una unidad de trabajo: un título, unos criterios de aceptación y un estado (`pending`, `running`, `done`, `failed`, `skipped`). El HU Board es donde kj las guarda. Por defecto es local a tu máquina; con `kj hu backend github` cada card es además una issue de GitHub del repositorio (con la etiqueta `kj:hu`), y kj también sabe trabajar con Linear.

Una card puede apuntar a su copia en otro gestor con `--ref` (Planning Game, Jira, Linear...) y puede decir cuánto modelo necesita con `--tier trivial|standard|deep`, que es el modelo con el que la escribe `kj code`.

## Por qué existe

Un trabajo sin card no tiene bordes. Nadie sabe decir qué se pidió, qué significa "terminado" ni si un cambio pertenece a él. Con un agente es peor: empieza con una cosa, se desvía a otra, y el historial ya no explica por qué cambió una línea.

Una card le da al trabajo un enunciado y unos criterios antes de empezar, y la rama que nombra la card ata cada commit a ella. El board es también cómo ves lo que está haciendo el agente sin preguntárselo.

## Cuándo actúa

| Momento | Qué pasa |
|---|---|
| **Antes de la primera edición** | El Sentinel no deja al agente editar código en `main`, ni en una rama cuyo nombre no lleve el id de una card. |
| **Antes de la revisión** | `kj review` rechaza un diff de una rama sin card. |
| **Después de un merge** | Cuando se mergea una pull request, su card hay que moverla. Hasta que se mueve, el Sentinel no deja al agente hacer commit, ni abrir ni mergear otra pull request. |
| **Al terminar el turno** | El agente no se para mientras las cards que ha cogido sigan esperando, salvo que diga por qué se para con una razón que kj pueda comprobar. |

## Cómo se usa

- `kj hu add "<título>" --ac "<criterio>"` crea una card. `kj hu list` las lista y `kj hu move <id> <estado>` mueve una.
- `kj hu start <id>` le abre un carril (un worktree con su propia rama) y la pone en `running`.
- `kj board start` abre el board en tu navegador, por defecto en `http://localhost:4000`. Solo escucha en tu máquina.

## Qué no hace

- **No decide qué se construye.** Lo decides tú o tu gestor; la card lo deja escrito.
- **No comprueba que el trabajo cumpla la card.** Que el cambio cumpla los criterios es cosa de los tests y de la [revisión cruzada](/docs/es/pieces/cross-review/).
- **Con el backend de GitHub, la issue es tan pública como tu repositorio.** No pongas secretos ni datos personales en los títulos de las cards.
- **No cuenta JSON, TOML ni Markdown como código** para el control de card: editar documentación en una rama sin card no se bloquea.
