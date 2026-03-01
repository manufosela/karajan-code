---
title: Inicio Rápido
description: Ejecuta tu primera tarea con Karajan Code.
---

## Tu Primera Ejecución

Después de [instalar](/docs/es/getting-started/installation/) Karajan Code y ejecutar `kj init`, estás listo:

```bash
kj run "Implementar autenticación de usuario con JWT"
```

Esto ejecuta el pipeline completo con defaults: Claude como coder, Codex como reviewer, metodología TDD.

## Workflows Comunes

### Solo coder (sin revisión)

```bash
kj code "Añadir validación de inputs al formulario de registro"
```

### Solo reviewer (revisar diff actual)

```bash
kj review "Revisar los cambios de autenticación"
```

### Generar un plan de implementación

```bash
kj plan "Refactorizar la capa de base de datos para usar connection pooling"
```

### Pipeline completo con todas las opciones

```bash
kj run "Corregir inyección SQL crítica en el endpoint de búsqueda" \
  --coder claude \
  --reviewer codex \
  --reviewer-fallback claude \
  --methodology tdd \
  --enable-triage \
  --enable-tester \
  --enable-security \
  --auto-commit \
  --auto-push \
  --max-iterations 5
```

## Qué Ocurre Durante una Ejecución

```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer → tester? → security? → commiter?
```

1. **Triage** (opcional) clasifica la complejidad y activa roles
2. **Coder** escribe código y tests siguiendo TDD
3. **SonarQube** ejecuta análisis estático con quality gates
4. **Reviewer** revisa el código con exigencia configurable
5. Si hay problemas, el **coder** recibe otra oportunidad
6. Bucle hasta aprobación o máximo de iteraciones

## Uso via MCP (Recomendado)

La mejor forma de usar Karajan Code es como servidor MCP dentro de tu agente de IA:

```json
{
  "mcpServers": {
    "karajan-mcp": {
      "command": "karajan-mcp"
    }
  }
}
```

Desde tu agente, simplemente pídele que use la herramienta `kj_run`. Ver [guía del Servidor MCP](/docs/es/guides/mcp-server/) para más detalles.

## Siguientes Pasos

- [Pipeline](/docs/es/guides/pipeline/) — Entender el pipeline completo
- [Configuración](/docs/es/guides/configuration/) — Personalizar comportamiento
- [Referencia CLI](/docs/es/reference/cli/) — Todos los comandos y flags
