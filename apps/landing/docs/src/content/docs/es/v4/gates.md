---
title: Los gates
description: Gates deterministas en git hacen el falso verde estructuralmente imposible.
---

Todo lo demás en Karajan son consejos a una IA. Los gates no: corren en git, son deterministas, y ningún modelo — por listo que sea — puede convencerlos. Esta es la lección sobre la que se construyó la v4: una demo real produjo una vez un run marcado "approved" con cero pasadas del reviewer. El arreglo no fue un prompt mejor; fue mover la garantía a git.

## El gate de revisión (pre-commit)

Con `.karajan/review-gate` presente (lo instala `kj review --install-gate`, trackeado en git para que todo el equipo lo herede):

1. Tu agente prepara un diff y ejecuta `kj review --staged` → SonarQube escanea primero los ficheros cambiados (pre-gate determinista: los findings BLOCKER/CRITICAL rechazan en el acto, sin gastar un token del reviewer), después una IA **distinta de él** revisa y registra el veredicto en `.karajan/reviews/<sha256-del-diff>.json`, estampado con el workspace desde el que corrió (`[root]` o `[worktree:<nombre>]`).
2. `git commit` dispara el pre-commit → `kj review --check` verifica que existe un veredicto **approved** para los bytes staged **exactos**.
3. Sin veredicto, veredicto caducado o rechazado → el commit no entra. Corregir, re-revisar, reintentar.

¿Rechazado pero el agente discrepa? `kj solomon` trae una tercera IA a arbitrar; un fallo approve registra un veredicto que abre el gate — auditable, con el conflicto completo adjunto. Los hallazgos de seguridad quedan fuera: sin arbitraje y sin anulación, siempre.

## Los otros gates

- **Rama primero** — los commits directos en la rama base se rechazan (`KJ_ALLOW_BASE_COMMIT=1` es la escotilla explícita para días de release).
- **Garantía de board** — `kj env install` verifica que existe vía de acceso operativa al board declarado del proyecto (el HU Board de kj, el MCP del Planning Game, o un board externo vía MCP/token de API) y bloquea con los pasos exactos cuando no la hay. No existe `none`: Karajan no funciona sin board.
- **Política de commits** — cabecera Conventional Commits, tope de longitud, sin atribución a IA.
- **Guards personales encadenados** — si tu máquina tenía hooks globales de git antes de Karajan, los hooks generados también los llaman. Activar Karajan añade protecciones; jamás quita las tuyas en silencio.
- **Paridad headless** — `kj run` (modo headless) estampa el veredicto de su reviewer interno igual, así que los commits del pipeline pasan el mismo gate.

## Opt-outs honestos

Cada gate es visible y reversible — borra el marcador, quita `core.hooksPath`, o no instales el gate. La promesa de Karajan no es que no puedas desactivarlo; es que **puedes verificar, en el repo, que nada saltó la revisión mientras estuvo activo**. La confianza pasa a ser una pregunta de `git log`.
