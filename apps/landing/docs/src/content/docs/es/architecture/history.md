---
title: Historial de Arquitectura
description: Cómo ha evolucionado la arquitectura de Karajan Code.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

## Línea Temporal

Esta página documenta las decisiones arquitectónicas principales y cómo Karajan Code ha evolucionado desde un simple orquestador hasta su pipeline multi-agente actual.

### Fase 1: Orquestador Simple
Versión inicial con bucle básico coder → reviewer.

### Fase 2: Quality Gates
Integración con SonarQube y TDD obligatorio.

### Fase 3: Pipeline Multi-Agente
Expansión a 11 roles con etapas de pipeline configurables.

### Fase 4: Servidor MCP
Servidor MCP para integración con agentes de IA (Claude, Codex).

### Fase 5: Extensibilidad (v1.3.0)
Sistema de plugins, retry con backoff, limpieza de sesiones y automatización Git.

## Referencias

- [jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) — Patrones de arquitectura hexagonal (puertos y adaptadores) que influyeron en el diseño de los adaptadores de agentes.
