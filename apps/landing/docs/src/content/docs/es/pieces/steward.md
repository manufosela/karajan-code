---
title: El Steward
description: La pieza que vuelve a comprobar, de vez en cuando, que las garantías del proyecto siguen en pie. Qué es, por qué existe, cuándo actúa, cómo se usa y qué no hace.
---

## Qué es

El Steward es una revisión periódica de la salud del proyecto. `kj steward sweep` recorre una lista de invariantes, las cosas que tienen que seguir siendo ciertas para que el método signifique algo, y le da un veredicto a cada una. Solo lee: no cambia nada de tu código.

Las invariantes que comprueba hoy:

| Invariante | La pregunta que responde |
|---|---|
| `main-ci` | ¿Lleva el CI de la rama base demasiado tiempo en rojo (3 días por defecto)? |
| `security-audit` | ¿Se ha hecho una auditoría de seguridad hace poco (14 días por defecto)? |
| `vulnerable-deps` | ¿Lleva una dependencia vulnerable demasiado tiempo esperando (crítica 7 días, alta 30)? |
| `dead-code-trend` | ¿Crece el código sin usar desde el último barrido? |
| `coverage-config` | ¿Hay un umbral de cobertura configurado, y lo aplica el CI? |
| `phantom-coverage` | ¿Hay tests que suman al recuento pero solo ejercitan código al que nada más llega? |
| `duplicate-members` | ¿Hay un miembro definido dos veces en una clase, de modo que el primero deja de ejecutarse sin avisar? |
| `runner-collects-agent-worktrees` | ¿Deja fuera el runner de tests los worktrees de los agentes? |
| `embedder-load` | ¿Puede cargar el embedder del RAG? |
| `merged-unverified` | ¿Se ha mergeado algo sin sus checks obligatorios en verde? |

Cada veredicto es uno de cuatro: **ok**, **broken** (roto), **unknown** (la comprobación no pudo responder) o **not-observable** (no se puede ver desde aquí). Una comprobación que falla da unknown, nunca ok.

## Por qué existe

Las demás piezas comprueban cada cambio en el momento en que ocurre. Pero una garantía también caduca sin que nadie toque el código: una dependencia pasa a ser vulnerable, main se queda en rojo durante días, nadie vuelve a pasar la auditoría de seguridad. Cada cambio puede estar bien mientras el proyecto, en conjunto, se deteriora.

El Steward es la pieza que dice "la confianza caduca". Vuelve a comprobar, de vez en cuando, lo que un día fue cierto, y dice claramente cuándo ya no lo es.

## Cuándo actúa

- **Cuando lo pides:** `kj steward sweep`, desde tu terminal o desde el agente.
- **Cada semana, si quieres:** con `steward.action: true` en `.karajan/kj.config.yml`, `kj harden` escribe un workflow que barre los lunes a las 06:17 UTC (y a demanda desde GitHub) y commitea el informe.
- **Cuando el agente empieza a editar:** el Sentinel le dice, una vez por sesión, qué invariantes están rotas o en unknown en el último informe.
- **Antes de una revisión o de un commit,** solo si has elegido que bloquee (abajo).

## Cómo se usa

Ejecuta `kj steward sweep`. Escribe el informe en `.karajan/steward/report.md` (y `report.json`), sella el barrido en el decision log y convierte cada invariante rota en una card propuesta en el HU Board. La card se actualiza en vez de duplicarse, y se resuelve cuando la invariante vuelve a estar en verde. `kj steward sweep` termina con error solo cuando algo está roto.

Por defecto el Steward **informa**. Tú decides si **bloquea**, con `method_gates.steward: block` en la configuración del proyecto. Entonces solo bloquean dos invariantes, y solo cuando están rotas: `vulnerable-deps` y `main-ci`. Un veredicto unknown nunca bloquea. Mientras estén rotas, el agente no puede empezar a editar y `kj review` rechaza. Si has elegido bloquear, un informe que falta o no se puede leer también bloquea: el barrido tiene que correr.

No hay excepción para saltárselo. Si el trabajo tiene que seguir, vuelves a poner `method_gates.steward` en `inform`. Esa decisión es tuya, no del agente: el Sentinel no deja que la sesión toque la configuración de gobierno.

## Qué no hace

- **No arregla nada.** Dice qué está roto y cómo renovarlo (por ejemplo "kj audit --security"); alguien tiene que hacerlo.
- **No exige un número de cobertura.** Comprueba que hay un umbral y que el CI lo aplica, no cuál es.
- **No bloquea si no se lo pides,** y aun así solo por las dos invariantes duras.
- **No juzga un cambio.** Eso es la [revisión cruzada](/docs/es/pieces/cross-review/) y los [controles de calidad](/docs/es/pieces/quality/). El Steward mira el proyecto, no el diff.
