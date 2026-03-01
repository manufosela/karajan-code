---
title: Servidor MCP
description: Usar Karajan Code como servidor MCP dentro de tu agente de IA.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

## Configuración

Tras `npm install -g karajan-code`, el servidor MCP se auto-registra en las configs de Claude y Codex.

Configuración manual:

```json
{
  "mcpServers": {
    "karajan-mcp": {
      "command": "karajan-mcp"
    }
  }
}
```

## Herramientas Disponibles

| Herramienta | Descripción |
|-------------|-------------|
| `kj_init` | Inicializar config y SonarQube |
| `kj_doctor` | Verificar dependencias del sistema |
| `kj_config` | Mostrar configuración |
| `kj_scan` | Ejecutar análisis SonarQube |
| `kj_run` | Ejecutar pipeline completo (con notificaciones de progreso en tiempo real) |
| `kj_resume` | Reanudar sesión pausada |
| `kj_report` | Leer informes de sesión (soporta `--trace`) |
| `kj_roles` | Listar roles o mostrar templates |
| `kj_code` | Modo solo coder |
| `kj_review` | Modo solo reviewer |
| `kj_plan` | Generar plan de implementación |
