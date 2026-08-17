# Monorepo familiar karajan con carriles aislados por sesión

Status: accepted
Date: 2026-08-17

## Context

La familia (karajan-code, karajan-rag, karajan-watch, karajan-radar, karajan-landing) vive en 5 repos: contexto fragmentado, cambios transversales multi-PR coordinados a mano, el ciclo release→landing exige delegación por issue, y el 2026-08-08 dos sesiones colisionaron en un mismo árbol en plena release. Propuesto por el usuario y validado 2026-08-17 (card KJC-PRP-0017).

## Decision

Un monorepo npm-workspaces 'karajan' que extiende el patrón ya existente en karajan-code (packages/*): packages/{kj,rag,watch,radar,hu-board,ai-trash,core} + apps/landing. Los nombres npm publicados NO cambian; los tableros PG por producto se mantienen; planning-game queda FUERA (otro producto). PREREQUISITO INNEGOCIABLE (fase 0): carril físico por sesión — cada sesión de Claude trabaja en su git worktree y el harness deniega escrituras fuera del carril propio (evolución de la regla 'nunca tocar un repo donde no estás' a 'nunca tocar un carril que no es tuyo'; identidad de carril = toplevel, identidad de repo = git-common-dir). Migración por fases reversibles con git subtree (historial preservado): 1 radar, 2 rag+watch, 3 landing (toolchain distinta, va última; el release check pasa a verificar la landing del propio árbol). Repos viejos archivados con puntero; issues transferidas. Alternativa descartada: meta-repo con submodules (fricción crónica, contexto sigue partido, resuelve poco pagando mucho).

## Consequences

Positivas: un contexto/RAG/policy/método para toda la familia; release+landing en UN PR (muere la delegación); cambios transversales atómicos con una sola review cruzada; N sesiones paralelas sin pisarse. Aceptadas: CI path-filtrado desde el día uno (no correr 6500 tests por un cambio de landing); historial entrelazado tras los subtree; verify-pack por workspace; fusionar SIN la fase 0 multiplicaría colisiones — por eso es prerequisito y no mejora posterior. Las fases 1-3 tocan repos ajenos: cada una lleva card+issue en el repo origen como manda la regla vigente.
