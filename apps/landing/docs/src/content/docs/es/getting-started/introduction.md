---
title: Introducción
description: Qué es Karajan Code y por qué usarlo.
---

Karajan Code (`kj`) orquesta múltiples agentes de IA a través de un pipeline automatizado: generación de código, análisis estático, revisión de código, testing y auditorías de seguridad — todo en un solo comando.

## El Problema

Hoy hay dos formas de usar agentes de IA para programar, y ambas tienen problemas serios:

**Uso manual** — Ejecutas un agente, esperas el código, lo revisas tú mismo, encuentras problemas, vuelves a hacer prompt y repites. No hay control de calidad sistemático. Es lento y depende enteramente de tu capacidad de revisión.

**Uso automatizado (CI/CD, GitHub Actions)** — Conectas agentes a pipelines que se ejecutan en cada push o issue. Esto elimina el cuello de botella manual, pero introduce un problema nuevo: **costes sin control**. Sin límites de iteración, topes de presupuesto o quality gates, una sola tarea puede quemar tokens indefinidamente. Un agente reintentando un enfoque fallido, un reviewer y un coder atrapados en un bucle, o una API inestable disparando reintentos ilimitados — todo eso se traduce en dinero real sin visibilidad hasta que llega la factura.

En ambos casos, no hay una forma estándar de asegurar calidad, controlar el gasto, o saber cuándo parar.

## La Solución

Karajan Code resuelve ambos problemas encadenando agentes con **quality gates** y **controles de coste**:

1. El **coder** escribe código y tests
2. **SonarQube** realiza análisis estático
3. El **reviewer** revisa el código
4. Si hay problemas, el **coder** recibe otra oportunidad
5. El bucle se repite hasta que el código es aprobado o se alcanza el límite de iteraciones

Cada sesión tiene guardarraíles integrados: **máximo de iteraciones**, **timeouts por iteración**, **timeout total de sesión**, y opcionalmente **topes de presupuesto estimado** (en USD o EUR). La detección fail-fast para el bucle cuando los agentes están dando vueltas en círculos. Obtienes informes de coste estimado con `kj report --trace`. Nota: Karajan ejecuta agentes CLI bajo tus suscripciones existentes — **no tiene coste adicional**. El tracking de presupuesto estima lo que costaría la sesión a precios de API, útil para comparar y como guardarraíl.

## Características Principales

- **Pipeline multi-agente** con 11 roles configurables
- **4 agentes de IA soportados**: Claude, Codex, Gemini, Aider
- **Servidor MCP** con 11 herramientas — usa `kj` desde tu agente de IA
- **TDD obligatorio** — se exigen cambios en tests cuando se modifican ficheros fuente
- **Integración con SonarQube** — análisis estático con quality gates
- **Perfiles de revisión** — standard, strict, relaxed, paranoid
- **Tracking de presupuesto estimado** — conteo de tokens por sesión con coste estimado equivalente a API (Karajan no tiene coste adicional — usa tus suscripciones CLI)
- **Automatización Git** — auto-commit, auto-push, auto-PR tras aprobación
- **Gestión de sesiones** — pausa/reanudación con detección fail-fast
- **Sistema de plugins** — extiende con agentes custom
- **Retry con backoff** — recuperación automática ante errores transitorios de API
- **Selección inteligente de modelos** — auto-selecciona el modelo óptimo por rol según la complejidad del triage
- **Resiliencia ante rate limits** — detecta rate limits, pausa la sesión, auto-fallback a otro agente
- **Checkpoints interactivos** — pausa cada 5 minutos con informe de progreso en lugar de matar tareas largas
- **Descomposición de tareas** — triage detecta cuándo dividir tareas y crea subtareas vinculadas en [Planning Game](https://github.com/manufosela/planning-game-xp)

## Mejor con MCP

Karajan Code está diseñado para usarse como **servidor MCP** dentro de tu agente de IA (Claude, Codex, etc.). El agente envía tareas a `kj_run`, recibe notificaciones de progreso en tiempo real, y obtiene resultados estructurados — sin copiar y pegar.

## Siguientes Pasos

- [Instalación](/docs/es/getting-started/installation/) — Instalar Karajan Code
- [Inicio Rápido](/docs/es/getting-started/quick-start/) — Ejecutar tu primera tarea
