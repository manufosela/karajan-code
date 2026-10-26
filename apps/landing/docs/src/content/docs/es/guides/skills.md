---
title: Modo Skills
description: Usa Karajan como slash commands de Claude Code — sin servidor MCP.
---

Karajan ofrece dos modos de operación:

| Modo | Ideal para | Requiere |
|------|-----------|----------|
| **Skills** | Un solo agente IA, setup simple | Solo Claude Code |
| **Orchestrator** | Pipeline multi-agente, control total | Servidor MCP + CLIs de agentes |

El modo Skills instala los roles de Karajan como **slash commands** en Claude Code. Cada comando es un prompt autocontenido con guardrails integrados — checks de seguridad, TDD, detección de operaciones destructivas y verificación de diff.

## Instalación

```bash
kj init
```

Durante el setup se pregunta si instalar los comandos de Karajan. Acepta, y van al almacén de atril en `.karajan/commands/`, bajo demanda. Desde la 5.0 ya no se copian a `.claude/commands/`.

En un proyecto que usa rulesync, `kj init` ejecuta además `atril sync`, que instala el puente `/atril <nombre o tarea>` en todas las CLIs: `/atril kj-run <tarea>` lanza el pipeline completo. Sin rulesync, ejecuta `rulesync init` y después `atril sync --root .karajan`.

También puedes instalarlos a mano:

```bash
atril install node_modules/karajan-code/templates/atril/commands/kj-run.md --root .karajan
```

## Skills Disponibles

### `/kj-run` — Pipeline Completo

Ejecuta todos los pasos en secuencia: discover → code → review → test → security → sonar → commit.

```
/kj-run Implementar autenticación de usuario con JWT
```

### `/kj-code` — Coder con Guardrails

Implementa una tarea siguiendo TDD con checks de calidad automáticos:

- Tests primero, luego implementación
- Check de seguridad (sin secrets hardcodeados, sin vectores de inyección)
- Check de operaciones destructivas (sin `rm -rf`, `DROP TABLE`, etc.)
- Check de rendimiento (sin I/O síncrono en handlers, sin `document.write`)
- Verificación de diff (`git diff` confirma que solo cambiaron las líneas previstas)

```
/kj-code Añadir paginación al endpoint de listado de usuarios
```

### `/kj-review` — Code Review

Revisa el diff actual contra estándares de calidad. Auto-bloquea:

- Credenciales o secrets hardcodeados
- Ficheros enteros sobreescritos en vez de ediciones puntuales
- Tests faltantes para ficheros fuente modificados
- Patrones de SQL injection, XSS, command injection

```
/kj-review Revisar cambios en el módulo de autenticación
```

### `/kj-test` — Auditoría de Tests

Evalúa cobertura y calidad de tests para ficheros modificados:

- Verifica que cada fichero fuente modificado tiene tests correspondientes
- Ejecuta la suite de tests y reporta resultados
- Detecta tests vacíos, tests que siempre pasan, tests con skip

```
/kj-test Auditar cobertura de tests de los cambios recientes
```

### `/kj-security` — Auditoría de Seguridad

Scan de seguridad enfocado en OWASP sobre el diff:

- Crítico: secrets hardcodeados, SQL/command injection, path traversal
- Alto: XSS, auth faltante, SSRF, deserialización insegura
- Medio: validación de input faltante, errores verbosos, CSRF faltante
- Bajo: headers de seguridad faltantes, vulnerabilidades conocidas en dependencias

```
/kj-security Escanear cambios de auth por vulnerabilidades
```

### `/kj-discover` — Detección de Gaps

Analiza una tarea buscando información faltante antes de codificar:

- Requisitos o criterios de aceptación faltantes
- Suposiciones implícitas que necesitan confirmación
- Ambigüedades con múltiples interpretaciones
- Contradicciones en la especificación

```
/kj-discover Revisar los requisitos del nuevo módulo de facturación
```

### `/kj-architect` — Diseño de Arquitectura

Propone arquitectura antes de implementar:

- Tipo de arquitectura y responsabilidades por capa
- Contratos de API y cambios en modelo de datos
- Tradeoffs con alternativas consideradas
- Preguntas de clarificación para stakeholders

```
/kj-architect Diseñar el sistema de notificaciones event-driven
```

### `/kj-sonar` — Análisis Estático

Ejecuta scan de SonarQube (si disponible) o análisis estático manual:

- Complejidad cognitiva, código duplicado, imports sin usar
- Catch blocks vacíos, ternarios anidados
- Estado del quality gate y desglose de issues

```
/kj-sonar Ejecutar análisis de calidad sobre cambios actuales
```

## Skills vs Orchestrator

| Característica | Skills | Orchestrator |
|---------------|--------|-------------|
| Setup | `kj init` → slash commands | Registro de servidor MCP |
| Agentes | Solo la IA host | Múltiples (Claude, Codex, Gemini, Aider, OpenCode) |
| Guardrails | En el prompt | En código (guards deterministas) |
| SonarQube | Manual o si Docker corre | Quality gate integrado |
| Gestión de sesiones | No | Completa (pausa, resume, budget) |
| Tracking de costes | No | Estimado por sesión |
| Ideal para | Tareas rápidas, desarrollador individual | Tareas complejas, pipelines CI/CD |

**Ambos modos pueden convivir** — usa skills para tareas rápidas y el orchestrator para trabajo complejo multi-agente.
