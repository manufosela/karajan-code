# La etiqueta Karajan en las PRs que abre el anfitrión

Status: proposed
Date: 2026-10-23

## Context

KJC-TSK-1123 (#2315): kj ya etiqueta las PRs que abre él mismo (kj run). En v4 casi todas las PRs las abre el anfitrión con gh pr create, y esas no llevan la etiqueta, así que el indicador de TRIBBU mediría poco.

## Decision

Propuesta: etiquetar en kj review --publish-pr, que el método ya ejecuta en cada PR: la etiqueta pasa a significar que la PR lleva la review de Karajan publicada. Alternativa: que el hook PostToolUse etiquete tras un gh pr create con éxito; cubre también repos sin publish-pr, pero da al hook un efecto de red y obliga a resellar el harness.

## Consequences

Con publish-pr, una PR abierta sin publicar su review queda sin etiqueta, lo que es coherente con pasó por Karajan. Con el hook, cada sesión hace una llamada más a GitHub por PR y el sello cambia.
