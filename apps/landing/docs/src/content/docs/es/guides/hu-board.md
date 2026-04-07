---
title: Dashboard HU Board
description: Dashboard web para visualizar historias de usuario y sesiones de Karajan Code.
---

## Qué es el HU Board?

Un dashboard web que visualiza todas las historias de usuario (HU) y sesiones del pipeline gestionadas por Karajan Code. Proporciona un tablero kanban, timeline de sesiones, puntuaciones de calidad y soporte multi-proyecto.

## Inicio Rápido

### Sin Docker
```bash
cd $(npm root -g)/karajan-code/packages/hu-board
npm install
kj board start
```

### Con Docker
```bash
cd $(npm root -g)/karajan-code/packages/hu-board
docker compose up -d
```

### Desde el CLI
```bash
kj board start    # Iniciar el dashboard
kj board stop     # Detenerlo
kj board status   # Comprobar si está corriendo
kj board open     # Abrir en el navegador
```

## Configuración

Activar en `kj.config.yml`:
```yaml
hu_board:
  enabled: true
  port: 4000
  auto_start: true  # Iniciar automáticamente con kj run
```

O activar durante el setup:
```bash
kj init  # Seleccionar "Enable HU Board" cuando se pregunte
```

## Características

- **Tablero Kanban**: Historias en columnas (Pending → Certified → Coding → Done)
- **Puntuaciones de Calidad**: Puntuaciones en 6 dimensiones con barras de progreso visuales
- **Timeline de Sesiones**: Desglose etapa por etapa con duraciones
- **Multi-Proyecto**: Auto-descubre todos los proyectos desde ~/.karajan/
- **Auto-Sincronización**: Vigila ficheros JSON para actualizaciones en tiempo real
- **Tema Oscuro**: Coincide con el diseño de Karajan Code
- **HUs Auto-Generadas**: Desde v1.38.0, el board muestra HUs generadas automáticamente a partir de tareas complejas — no solo las proporcionadas manualmente. Cuando el triage activa hu-reviewer para tareas medias/complejas, las HUs descompuestas aparecen en el board con su estado de sub-pipeline (pending/coding/reviewing/done/failed/blocked)
- **Sincronización con Planes (v2.5.0)**: Las HUs generadas con `kj plan` también se rastrean en el board. Al ejecutar `kj run --plan <planId>`, el board muestra el estado del sub-pipeline de cada HU en tiempo real, agrupadas por su plan de origen
- **Tests de Aceptación (v2.4.0+)**: Cada tarjeta HU muestra sus tests de aceptación ejecutables y su estado pasa/falla tras cada iteración del coder
- **Fallback de Puerto**: Arranca en el puerto 4000 por defecto; prueba automáticamente 4001–4009 si el puerto primario está ocupado
- **Historial de Pipeline**: Se generan registros de historial para todas las ejecuciones del pipeline, proporcionando trazabilidad completa entre tareas y sus descomposiciones en HUs

## Cómo Funciona

El board lee ficheros JSON desde `~/.karajan/hu-stories/` y `~/.karajan/sessions/`. SQLite se usa como índice para consultas rápidas — si se elimina, se reconstruye desde los ficheros JSON en el siguiente arranque.

## Herramienta MCP

Disponible como herramienta MCP `kj_board`:
```
kj_board({ action: "start", port: 4000 })
kj_board({ action: "open" })
kj_board({ action: "status" })
kj_board({ action: "stop" })
```

## Arranque Automático

El board arranca automáticamente cuando:
- `hu_board.auto_start: true` está configurado en `kj.config.yml`
- `kj run` genera un batch automático de HUs para una tarea compleja

En ambos casos el board se inicia antes de que comience la ejecución del pipeline, de modo que las historias aparecen en el board en cuanto la primera HU entra al pipeline.
