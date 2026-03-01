---
title: Introducción
description: Qué es Karajan Code y por qué usarlo.
---

Karajan Code (`kj`) orquesta múltiples agentes de IA a través de un pipeline automatizado: generación de código, análisis estático, revisión de código, testing y auditorías de seguridad — todo en un solo comando.

## El Problema

Ejecutar un agente de IA y revisar manualmente su output es lento y propenso a errores. Escribes un prompt, esperas el código, lo revisas tú mismo, encuentras problemas, vuelves a hacer prompt y repites. No hay control de calidad sistemático.

## La Solución

Karajan Code encadena agentes con **quality gates**:

1. El **coder** escribe código y tests
2. **SonarQube** realiza análisis estático
3. El **reviewer** revisa el código
4. Si hay problemas, el **coder** recibe otra oportunidad
5. El bucle se repite hasta que el código es aprobado o se alcanza el límite de iteraciones

## Características Principales

- **Pipeline multi-agente** con 11 roles configurables
- **4 agentes de IA soportados**: Claude, Codex, Gemini, Aider
- **Servidor MCP** con 11 herramientas — usa `kj` desde tu agente de IA
- **TDD obligatorio** — se exigen cambios en tests cuando se modifican ficheros fuente
- **Integración con SonarQube** — análisis estático con quality gates
- **Perfiles de revisión** — standard, strict, relaxed, paranoid
- **Tracking de presupuesto** — monitorización de tokens y costes por sesión
- **Automatización Git** — auto-commit, auto-push, auto-PR tras aprobación
- **Gestión de sesiones** — pausa/reanudación con detección fail-fast
- **Sistema de plugins** — extiende con agentes custom
- **Retry con backoff** — recuperación automática ante errores transitorios de API

## Mejor con MCP

Karajan Code está diseñado para usarse como **servidor MCP** dentro de tu agente de IA (Claude, Codex, etc.). El agente envía tareas a `kj_run`, recibe notificaciones de progreso en tiempo real, y obtiene resultados estructurados — sin copiar y pegar.

## Siguientes Pasos

- [Instalación](/docs/es/getting-started/installation/) — Instalar Karajan Code
- [Inicio Rápido](/docs/es/getting-started/quick-start/) — Ejecutar tu primera tarea
