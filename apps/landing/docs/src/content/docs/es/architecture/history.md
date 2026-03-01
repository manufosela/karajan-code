---
title: Historial de Arquitectura
description: Cómo ha evolucionado la arquitectura de Karajan Code.
---

Esta página documenta las decisiones arquitectónicas principales y cómo Karajan Code evolucionó desde un simple script orquestador hasta un pipeline modular multi-agente.

## Fase 1: Orquestador Simple (v0.x)

**Qué era:** Un único script que ejecutaba Claude CLI sobre una tarea, luego ejecutaba Codex CLI para revisar el output. Sin config, sin sesiones, sin quality gates.

**Arquitectura:**
```
tarea → claude → diff → codex review → done
```

**Limitaciones:**
- Hardcoded a dos agentes (Claude + Codex)
- Sin reintentos ante fallos
- Sin tracking de costes
- Sin integración con SonarQube ni testing
- Script monolítico, difícil de extender

## Fase 2: Quality Gates (v1.0)

**Qué cambió:** Se añadió análisis estático SonarQube como paso obligatorio entre codificación y revisión. Se añadió TDD obligatorio para asegurar que se escriben tests junto al código.

**Adiciones clave:**
- Integración Docker con SonarQube (auto-arranque, scan, enforcement de quality gate)
- Política TDD (cambios en source requieren cambios en tests)
- Fichero de configuración (`kj.config.yml`) con primeros defaults
- Tracking de sesiones (metadatos básicos de ejecución)

**Arquitectura:**
```
tarea → coder → sonar → reviewer → done
                          ↑          │
                          └── bucle ─┘
```

**Por qué:** El código generado por IA sin quality gates frecuentemente introducía code smells, saltaba tests o tenía problemas de seguridad. SonarQube proporcionó un chequeo de calidad objetivo y automatizado independiente del reviewer.

## Fase 3: Pipeline Basado en Roles (v1.1)

**Qué cambió:** Refactorización del orquestador monolítico a una arquitectura basada en roles. Cada responsabilidad del pipeline se convirtió en un rol discreto con sus propias instrucciones, agente y modelo.

**Adiciones clave:**
- Abstracción `BaseRole` (ciclo de vida init → execute → report)
- Abstracción `BaseAgent` (interfaz uniforme para todos los agentes CLI)
- Registry de agentes (register, create, resolve)
- 11 roles configurables: triage, researcher, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter
- Perfiles de revisión (standard, strict, paranoid, relaxed)
- Instrucciones de roles como templates markdown (sobreescribibles)
- Detección de repeticiones y lógica fail-fast
- Escalado Solomon para resolución de conflictos
- Tracking de presupuesto con costes estimados

**Arquitectura:**
```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer
                                                                      ↓
                                                         tester? → security? → commiter?
```

**Por qué:** El orquestador monolítico se había vuelto difícil de mantener y extender. Añadir una nueva capacidad (como auditorías de seguridad) significaba modificar el bucle central. El patrón basado en roles hizo cada responsabilidad independientemente testeable y configurable.

**Inspiración:** [jorgecasar/legacy-s-end-2/packages/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) usa una arquitectura hexagonal limpia con:
- **Capa de dominio**: Modelos e interfaces de puertos
- **Casos de uso**: plan-issue, implement-issue, review-pr, check-task-readiness, track-cost-report
- **Infraestructura**: Adaptadores para Anthropic, Gemini, OpenAI, GitHub, GitCli

Esto influyó en la separación de Karajan entre la interfaz de agente (`BaseAgent` como puerto) e implementaciones concretas (Claude, Codex, Gemini, Aider como adaptadores). El sistema de roles es paralelo a la capa de casos de uso — cada rol es una unidad de orquestación autocontenida.

## Fase 4: Servidor MCP (v1.2)

**Qué cambió:** Se añadió un servidor Model Context Protocol (MCP) para que Karajan pueda usarse desde dentro de agentes IA (Claude Code, Codex) en lugar de solo desde el terminal.

**Adiciones clave:**
- Servidor MCP stdio con 11 herramientas (kj_run, kj_code, kj_review, etc.)
- Notificaciones de progreso en tiempo real via logging MCP
- Auto-registro en Claude Code y Codex
- Orphan guard para prevenir procesos zombie
- Pausa/reanudación de sesiones via MCP (`kj_resume`)

**Adición a la arquitectura:**
```
┌──────────────────┐
│ Agente IA (Claude)│
│                  │──── MCP (stdio) ────→ karajan-mcp ──→ subproceso CLI
│                  │←─── progreso/result ─┘
└──────────────────┘
```

**Por qué:** La forma más potente de usar Karajan no es desde el terminal, sino desde dentro de la conversación de un agente IA. El servidor MCP permite a Claude o Codex delegar tareas complejas al pipeline de Karajan, recibir actualizaciones de progreso en tiempo real y obtener resultados estructurados — todo sin salir de la conversación.

## Fase 5: Extensibilidad (v1.3)

**Qué cambió:** Sistema de plugins, integración con Planning Game y hardening de producción.

**Adiciones clave:**
- Sistema de plugins: `.karajan/plugins/*.js` para agentes custom
- Integración Planning Game MCP (enriquecimiento de cards, actualización de estados)
- Retry con backoff exponencial y jitter
- Limpieza de sesiones (auto-expirar sesiones antiguas)
- Automatización git (auto-commit, auto-push, auto-PR, auto-rebase)
- Cadena de fallback de reviewer (primario → fallback → Solomon)
- Overrides via variables de entorno (`KJ_HOME`, `KJ_SONAR_TOKEN`)

**Por qué:** Los usuarios necesitaban integrar Karajan en sus workflows existentes — gestión de proyectos (Planning Game), herramientas IA custom (plugins) y CI/CD (automatización git). El sistema de plugins fue particularmente importante: permite a cualquiera envolver su propia herramienta CLI como agente de Karajan sin modificar el código fuente.

## Decisiones Arquitectónicas Clave

### CLI wrapping vs llamadas directas a API

Karajan envuelve CLIs existentes de agentes IA (claude, codex, gemini, aider) en lugar de llamar a APIs de proveedores IA directamente.

**Ventajas:**
- Usa tus suscripciones existentes — no necesitas API keys separadas
- Coste predecible — pagas la tarifa de tu plan, no por token
- Los agentes gestionan su propio contexto, uso de herramientas y características de seguridad
- Se actualiza automáticamente cuando actualizas el CLI

**Trade-offs:**
- Menos control granular sobre prompts y parámetros
- El tracking de costes es estimado, no facturación real
- El rate limiting lo gestiona el CLI, no Karajan

### Instrucciones de roles basadas en Markdown

Las instrucciones de roles (qué hacer, cómo revisar, qué reglas aplicar) se almacenan como ficheros `.md`, no hardcoded.

**Ventajas:**
- Los usuarios pueden sobreescribir cualquier rol sin tocar código
- Resolución a tres niveles: proyecto → usuario → built-in
- Fácil de versionar y compartir
- No-desarrolladores pueden modificar reglas de revisión

### Persistencia de sesiones en disco

Todo el estado de sesión se escribe en disco como ficheros JSON, no se mantiene en memoria.

**Ventajas:**
- Sobrevive a caídas y reinicios
- Permite pausa/reanudación entre sesiones
- Permite informes post-ejecución y audit trails
- Sin dependencia de base de datos

### Tracking de presupuesto estimado

El uso de tokens se cuenta y los costes se estiman usando tarifas publicadas, en lugar de consultar la facturación real de la API.

**Ventajas:**
- Funciona con agentes CLI que no exponen datos de facturación
- Proporciona comparación relativa de costes entre enfoques
- Permite guardarraíles de presupuesto (avisar al 80%, parar al 100%)

**Trade-off:** Los costes reportados son aproximados — útiles para comparación y guardarraíles, no para facturación.

## Referencias

- [jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) — Patrones de arquitectura hexagonal (puertos y adaptadores) que influyeron en el diseño de adaptadores de agentes
- [ADR-001: Role-Based AI Architecture](/docs/es/architecture/overview/) — Architecture Decision Record en el repositorio de karajan-code
- [Model Context Protocol](https://modelcontextprotocol.io/) — El estándar usado para la integración del servidor MCP de Karajan
