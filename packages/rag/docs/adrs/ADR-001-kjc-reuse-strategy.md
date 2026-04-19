# ADR-001 — Reutilización de Karajan Code vía copy + attribution

- **Status**: proposed
- **Date**: 2026-04-19
- **Deciders**: equipo KJR
- **Related tasks**: KJR-TSK-0013 (inventario), KJR-TSK-0014 (este ADR), KJR-TSK-0015 / KJR-TSK-0016 (portaciones)
- **PG ADR ID**: `-Oq_HrBnHOAIHgx1f0ct`

## Context

Karajan RAG (KJR) y [Karajan Code](https://github.com/manufosela/karajan-code) (KJC) comparten patrones arquitectónicos: adapters CLI para múltiples proveedores (Claude, Codex, Gemini…), sistema de roles con registry, pipeline por stages, capa de guards deterministas, DI para tests.

KJC está maduro (v2.5.0, 80 releases, 2 599 tests, 23 MCP tools). KJR acaba de arrancar. Existen tres caminos para aprovechar lo ya probado:

1. **Extraer un `karajan-core`** del que dependan ambos proyectos.
2. **Monorepo** con `packages/{core,code,rag}`.
3. **Copia selectiva con atribución** desde KJC a KJR.

La opción 1 implica refactorizar un proyecto estable para extraer un common lib antes de que KJR haya validado sus supuestos de dominio RAG — alto riesgo de sobre-abstracción prematura. La opción 2 acopla ciclos de release y fuerza que ambos verticales se muevan en lock-step, perdiendo autonomía. La opción 3 mantiene ambos independientes y permite divergencia controlada.

El inventario en [`docs/mining-kjc.md`](../mining-kjc.md) identifica los módulos candidatos (`base-agent.js`, `agents/index.js`, `base-role.js`, `roles/index.js`, `stage-executor.js`, `infrastructure/environment.js`…) que encajan en Sprint 1 de KJR sin arrastrar dependencias específicas del dominio "código".

## Decision

**Reutilizar Karajan Code mediante copia selectiva de ficheros a Karajan RAG, con atribución obligatoria en cada fichero portado.**

Condiciones:

1. **Atribución**: cada fichero portado incluye cabecera al inicio con el formato:
   ```js
   // Portado de karajan-code@<commit-hash> <ruta/original/en/kjc.js>
   // KJR-TSK-XXXX · Licencia AGPL-3.0-or-later (compatible con KJR).
   ```
2. **Adaptación al dominio RAG**: tipos, paths y nombres se ajustan a la semántica RAG. No se conservan referencias literales a conceptos de coding (`coder`, `reviewer`, `hu`, etc.).
3. **Inventario vivo**: [`docs/mining-kjc.md`](../mining-kjc.md) se actualiza marcando qué se ha portado y en qué tarea KJR, para trazabilidad.
4. **Licencia**: KJR mantiene **AGPL-3.0-or-later** para garantizar compatibilidad con el código portado (KJC también es AGPL-3.0).
5. **Sin dependencia npm entre KJR y KJC**. No se crea monorepo.
6. **Reevaluación**: cuando el overlap entre KJR y KJC supere ~60% del código base de KJR (medición cualitativa anual o cuando se perciba duplicación costosa), se abrirá un nuevo ADR valorando extraer `karajan-core`.

## Consequences

### Positivas

- **Velocidad inicial**: KJR parte de patrones ya probados sin bloquear a KJC.
- **Autonomía**: cada vertical evoluciona a su ritmo. Bugs o refactors en KJC no afectan a KJR y viceversa.
- **Claridad licencial**: AGPL en ambos lados, sin fricción legal.
- **Trazabilidad**: la cabecera estandarizada permite futuros scripts de diff automático contra el KJC live para decidir syncs manuales.

### Negativas

- **Duplicación**: un mismo bug puede aparecer en ambos proyectos y requiere fix manual en cada lado. No hay propagación automática.
- **Carga cognitiva**: el mantenedor debe distinguir entre piezas "lineales" (portadas, susceptibles de resync) y "divergentes" (propias de KJR).
- **Coste futuro de extracción**: cuanto más se tarde en extraer `karajan-core`, más código a refactorizar si se decide en el futuro.

### Mitigaciones

- La cabecera estandarizada habilita herramientas de comparación futuras (diff por ruta original).
- Revisión del inventario `mining-kjc.md` al cierre de cada sprint.
- Trigger de reevaluación documentado (overlap ~60%) para no postergar indefinidamente la decisión.

## Links

- Código fuente KJC: https://github.com/manufosela/karajan-code
- Inventario de módulos: [`docs/mining-kjc.md`](../mining-kjc.md)
- Tasks derivadas: KJR-TSK-0015 (port base-role), KJR-TSK-0016 (port agents/index registry).
