# Sentinel testeable y memoria de reglas

Status: accepted
Date: 2026-10-03
Accepted: 2026-10-03 (dev_001)

## Context

La racha de bugs del Sentinel (#1886 y siguientes) salió casi entera de un sitio: lógica de seguridad escrita dentro de plantillas-string de `sentinel-hooks.js`, con escapes dobles y sin tests unitarios, solo probada ejecutando el hook. Además, el agente pierde reglas de sus md cuando el contexto se comprime: no las olvida al leerlas, olvida aplicarlas en el momento.

## Decision

1. Los guards son módulos `.mjs` reales bajo `src/harden/sentinel/`, sin dependencias salvo `node:*` y con la raíz inyectada. `kj harden` los copia tal cual al harness; al estar en `SCRIPT_BODIES`, el registro de instalación, el tamper check y el sello humano los cubren. Las plantillas solo importan y cablean. No se añaden más parches de parseo de shell dentro de plantillas.
2. Recordatorios en el momento de la acción: reglas asociadas a una acción (commit, gh, merge, sync de main) que el hook inyecta como contexto. Avisar no es denegar.
3. Tras una compactación (SessionStart), el Sentinel reinyecta las reglas críticas del proyecto y el estado de la sesión, cortas.

Alternativas descartadas: un hook-shim que llama a `kj sentinel pre` (arranque de kj en cada tool call y gate caído si kj falla); seguir con plantillas-string (la causa de la racha).

## Consequences

Cada guard se prueba por unidad. El harness gana un fichero por módulo, que un harness sellado viejo no tiene hasta `kj harden --commit` (su plantilla vieja tampoco lo importa). Límite que se mantiene: un programa ejecutado puede escribir ficheros; eso solo lo frena un sandbox.
