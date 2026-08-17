# Policy layer: gobernanza determinista en la capa de ejecución

Status: accepted
Date: 2026-08-17

## Context

Hoy las reglas de proyecto viven repartidas: instrucciones al modelo (skills, CLAUDE.md, briefs) que son peticiones, y gates deterministas artesanales (card-first, branch-first, LOC, privacy, sonar) cableados uno a uno en kj. No hay capa de política unificada: cada regla nueva exige un PR a medida, y las reglas de contexto dependen de que el LLM las respete. Propuesto por el usuario 2026-08-17 (card KJC-PRP-0016); análisis validado.

## Decision

Una capa de política con UN motor determinista (src/policy/engine.js, módulo puro, vocabulario de predicados CERRADO: write/shell/deps/imports/thresholds) evaluando .karajan/policy.yml (policy as code versionado, defaults embarcados, deny-wins) en TRES tiers: A) intercepción inline al tool-time donde el anfitrión da hooks (el PRETOOL del Sentinel delega en kj policy eval; deniega con regla y motivo, no instruye); B) chokepoint agente-agnóstico sobre el RESULTADO en pre-commit y kj review (la garantía: el diff violador no entra aunque el agente no pase por A); C) re-check en CI (merge-blocking, cubre hook local manipulado). El usuario declara reglas hablando (kj policy add traduce); el YAML es artefacto, no interfaz. Cambios de policy.yml van por PR con review cruzada; denegaciones de clase seguridad no arbitrables. Umbrales existentes (LOC, coverage, mutation-license de REWORK) migran a fuente única en el policy file. El motor nace como librería con tercer consumidor previsto: middleware del routing híbrido (kj-server), que universalizaría el tier A.

## Consequences

Positivas: reglas decidibles dejan de ser peticiones; fuente única de umbrales; REWORK/SPD consume metric-thresholds del policy file (secuencia: motor antes que SPD-A); torneos/crown heredan gratis. Aceptadas: tier A solo garantizado con anfitrión Claude hoy (documentar en Guarantee levels); las reglas de juicio (TDD como proceso, calidad de alternativas, review rules, estilo) SIGUEN siendo instrucciones al modelo — el criterio de frontera es 'predicado sobre tool-call/diff/árbol/métrica ⇒ migra; intención ⇒ prompt'; riesgo de falsos positivos que queman iteraciones ⇒ despliegue warn-first por regla + telemetría de denegaciones; el vocabulario cerrado evita que la policy se convierta en segunda codebase (nada turing-completo).
