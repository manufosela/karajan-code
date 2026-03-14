---
title: Introducción
description: Qué es Karajan Code y por qué usarlo.
---

Karajan Code (`kj`) es un **orquestador de IA basado en roles**. Define **13 roles especializados** (triage, researcher, architect, planner, coder, reviewer, tester, security...) y asigna cada uno a un **agente de IA** (Claude, Codex, Gemini, Aider u OpenCode). Los roles determinan *qué* hacer; los agentes determinan *quién* lo hace. Puedes combinarlos libremente — usar Claude como coder y Codex como reviewer, o cualquier combinación — mientras el pipeline aplica quality gates, controles de coste estimado y guards deterministas entre cada etapa. Como Karajan usa los CLIs de los agentes (no APIs directas), funciona con tus suscripciones existentes sin coste adicional.

## El Problema

Hoy hay dos formas de usar agentes de IA para programar, y ambas tienen problemas serios:

**Uso manual** — Ejecutas un agente, esperas el código, lo revisas tú mismo, encuentras problemas, vuelves a hacer prompt y repites. No hay control de calidad sistemático. Es lento y depende enteramente de tu capacidad de revisión.

**Uso automatizado (CI/CD, GitHub Actions)** — Conectas agentes a pipelines que se ejecutan en cada push o issue. Esto elimina el cuello de botella manual, pero introduce un problema nuevo: **costes sin control**. Sin límites de iteración, topes de presupuesto o quality gates, una sola tarea puede quemar tokens indefinidamente. Un agente reintentando un enfoque fallido, un reviewer y un coder atrapados en un bucle, o una API inestable disparando reintentos ilimitados — todo eso se traduce en dinero real sin visibilidad hasta que llega la factura.

En ambos casos, no hay una forma estándar de asegurar calidad, controlar el gasto, o saber cuándo parar.

## La Solución

Karajan Code resuelve ambos problemas encadenando **roles** con **quality gates** y **controles de coste**. Cada rol es una etapa del pipeline con una responsabilidad clara, ejecutada por el agente de IA que tú elijas:

1. El rol **coder** escribe código y tests (ej. Claude)
2. **Guards deterministas** escanean el diff buscando operaciones destructivas, fugas de credenciales y anti-patrones de rendimiento
3. **SonarQube** realiza análisis estático
4. El rol **reviewer** revisa el código (ej. Codex)
5. Si hay problemas, el **coder** recibe otra oportunidad
6. El bucle se repite hasta que el código es aprobado o se alcanza el límite de iteraciones

Cada sesión tiene guardarraíles integrados: **máximo de iteraciones**, **timeouts por iteración**, **timeout total de sesión**, y opcionalmente **topes de presupuesto estimado** (en USD o EUR). La detección fail-fast para el bucle cuando los agentes están dando vueltas en círculos. Obtienes informes de coste estimado con `kj report --trace`. Nota: Karajan ejecuta agentes CLI bajo tus suscripciones existentes — **no tiene coste adicional**. El tracking de presupuesto estima lo que costaría la sesión a precios de API, útil para comparar y como guardarraíl.

## Características Principales

- **Pipeline basado en roles** con 13 roles especializados — cada uno asignable a cualquier agente
- **5 agentes de IA soportados**: Claude, Codex, Gemini, Aider, OpenCode — combinalos por rol
- **Sistema de plugins** — extiende con agentes custom via `.karajan/plugins/`
- **Guards deterministas** — output guard (ops destructivas, fugas de credenciales), perf guard (anti-patrones frontend), intent classifier (pre-triage sin LLM)
- **Servidor MCP** con 16 herramientas — usa `kj` desde tu agente de IA
- **TDD obligatorio** — se exigen cambios en tests cuando se modifican ficheros fuente
- **Integración con SonarQube** — análisis estático con quality gates
- **Perfiles de revisión** — standard, strict, relaxed, paranoid
- **Tracking de presupuesto estimado** — conteo de tokens por sesión con coste estimado equivalente a API (Karajan no tiene coste adicional — usa tus suscripciones CLI)
- **Automatización Git** — auto-commit, auto-push, auto-PR tras aprobación
- **Gestión de sesiones** — pausa/reanudación con detección fail-fast
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
