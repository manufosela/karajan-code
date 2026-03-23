---
title: Dashboard HU Board
description: Dashboard web para visualizar historias de usuario y sesiones de Karajan Code.
---

## Que es el HU Board?

Un dashboard web que visualiza todas las historias de usuario (HU) y sesiones del pipeline gestionadas por Karajan Code. Proporciona un tablero kanban, timeline de sesiones, puntuaciones de calidad y soporte multi-proyecto.

## Inicio Rapido

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
kj board status   # Comprobar si esta corriendo
kj board open     # Abrir en el navegador
```

## Configuracion

Activar en `kj.config.yml`:
```yaml
hu_board:
  enabled: true
  port: 4000
  auto_start: true  # Iniciar automaticamente con kj run
```

O activar durante el setup:
```bash
kj init  # Seleccionar "Enable HU Board" cuando se pregunte
```

## Caracteristicas

- **Tablero Kanban**: Historias en columnas (Pending → Certified → Coding → Done)
- **Puntuaciones de Calidad**: Puntuaciones en 6 dimensiones con barras de progreso visuales
- **Timeline de Sesiones**: Desglose etapa por etapa con duraciones
- **Multi-Proyecto**: Auto-descubre todos los proyectos desde ~/.karajan/
- **Auto-Sincronizacion**: Vigila ficheros JSON para actualizaciones en tiempo real
- **Tema Oscuro**: Coincide con el diseno de Karajan Code

## Como Funciona

El board lee ficheros JSON desde `~/.karajan/hu-stories/` y `~/.karajan/sessions/`. SQLite se usa como indice para consultas rapidas — si se elimina, se reconstruye desde los ficheros JSON en el siguiente arranque.

## Herramienta MCP

Disponible como herramienta MCP `kj_board`:
```
kj_board({ action: "start", port: 4000 })
kj_board({ action: "status" })
kj_board({ action: "stop" })
```
