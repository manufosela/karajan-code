---
title: "Carriles: una tarea, un worktree"
description: Por qué kj da a cada tarea su propio worktree de git, cómo abrir, listar y cerrar un carril, y qué hace cumplir el Sentinel sobre ellos.
---

Un carril es un worktree de git de tu repo, con su propia rama, que lleva una tarea. Dos sesiones nunca comparten árbol: cada una trabaja en su carril.

## Por qué existen los carriles

El 2026-08-08 dos sesiones trabajaban sobre el mismo árbol en plena release. Un commit de release cayó en la rama de la otra sesión y un push subió una rama vacía, porque ninguna de las dos veía el estado de git entero. Fusionar la familia de repos en un monorepo habría multiplicado esas colisiones, así que el carril físico por sesión fue lo primero (MONO-0, ADR 0002).

## Abrir, listar y cerrar un carril

```sh
kj worktree start <slug>
kj worktree list
kj worktree done <slug>
```

- `kj worktree start <slug>` crea el worktree, corta la rama `feat/<slug>` desde `origin/<base>` y prepara las dependencias. `--base <rama>` corta el carril desde `origin/<rama>` y la mantiene como base del carril para el tamaño de la PR, `kj check` y el gate de review.
- `kj worktree list` muestra los carriles activos. Con `--json` añade los commits de cada carril por delante de la base y las cards que nombra su rama; con `--prs` añade además la PR de cada carril.
- `kj worktree done <slug>` borra el carril y elimina su rama cuando ya está mergeada en la base. Se niega a borrar un carril con cambios sin commitear salvo que pases `--force`, que además elimina la rama aunque no esté mergeada.

Para comprobar que estás en un carril y no en el checkout principal, `git rev-parse --git-dir` debe ser distinto de `git rev-parse --git-common-dir`.

Todos los carriles usan la única configuración local del operador (`.karajan/kj.config.yml` y `rules.local.yml`): cada carril la enlaza a la copia del checkout principal, y no existe configuración por carril. Mira el [contrato de funcionamiento](/docs/es/guides/operating-contract/).

La lista completa de opciones está en la [referencia de comandos](/docs/es/v4/commands/).

## Qué hace cumplir el Sentinel

El [Sentinel](/docs/es/guides/sentinel/#cross-lane) juzga cada escritura por el carril de la ruta que toca (ADR 0034). Para Edit y Write es el worktree que contiene el fichero. Para Bash es el worktree del directorio donde corre el comando, o el destino de `git -C` o `--prefix`.

- **Una sola sesión viva por carril.** Se rechaza una escritura, con el motivo, cuando otra sesión viva tiene ese carril: la que empezó allí o la que cambió a él (ADR 0033). Una sesión que escribe en un carril renueva su marca de presencia allí, y un carril en el que deja de escribir se libera pasado el periodo de inactividad. Un carril donde otra sesión viva escribió en los últimos 30 minutos se rechaza.
- **Una sesión puede tener varios carriles.** Lleva varias tareas en paralelo, una marca por carril. Dos sesiones nunca escriben en el mismo carril.
- **Cada escritura se juzga con su propio carril.** Su rama, su card y su supervisor son los del carril, no los del checkout donde empezó la sesión.
- **Leer es libre.** Cualquier sesión puede leer cualquier carril.
- **Se rechazan las mutaciones que no puede verificar.** Entre ellas, `cd` en una cadena mutadora, la sustitución de comandos, la expansión de shell y las redirecciones cuyo destino se esconde tras una variable. Usa `git -C`, `npm --prefix` y rutas literales.

## Qué puede seguir haciendo una persona

No hay escape para el agente (ADR 0015). Un cruce deliberado entre carriles, o una escritura que el guard rechaza, es cosa tuya: hazlo en tu propia terminal, fuera de la sesión.
