---
title: Dashboard HU Board
description: Dashboard web para visualizar historias de usuario y sesiones de Karajan Code.
---

## Qué es el HU Board?

Un dashboard web que visualiza todas las historias de usuario (HU) y sesiones del pipeline gestionadas por Karajan Code. Proporciona un tablero kanban, timeline de sesiones, puntuaciones de calidad y soporte multi-proyecto.

## En la práctica, desde tu agente

Más allá del kanban, el board tiene una vista **Governance**, el acta encadenada por hash del proyecto, en vivo. Cada decisión que toma el entorno (un deny, una excepción con su caducidad y su ámbito, un veredicto de revisión, un resellado del supervisor) aterriza ahí sellada, y cada entrada lleva la huella criptográfica de la anterior. Así, mientras tu agente trabaja, puedes leer, en un navegador, sin terminal, exactamente qué se decidió y por quién, con la certeza de que nadie reescribió el registro de ayer sin que se note.

El trabajo en paralelo también se ve. Una card que se trabaja en un carril de `kj worktree` lleva una etiqueta con el carril, su rama, sus commits por delante de la base y su PR. La vista Governance lista los carriles fuera del método: una rama que no nombra ninguna card y un carril cuya PR ya está mergeada, con el `kj worktree done <slug>` exacto que lo despeja. Todo se lee de git cada vez, no se guarda nada.

## Bajo el capó, pruébalo tú mismo

El acta es un fichero plano de solo-añadido donde cada línea liga la anterior:

```sh
cat .karajan/policy-decisions.jsonl   # una decisión JSON por línea; cada una lleva un hash "prev"
kj policy report                      # lo mismo, como informe legible (una cadena rota sale con exit 1)
kj policy anchor                      # re-verifica TODA la cadena y sella su head-hash en git
```

Una vez commiteado el head-hash (`kj policy anchor` escribe `.karajan/policy-anchor.json`), reescribir el pasado obliga a reescribir también la historia del repo, y eso se nota.

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
- **Fallback de Puerto**: Arranca en el puerto 4000 por defecto; prueba automáticamente 4001–4009 si el puerto primario está ocupado
- **Carriles y Gobierno**: cada card muestra su carril, rama, commits por delante y PR; la vista de Gobierno lista los carriles fuera del método

Hasta la 4.x el board podía lanzar también el pipeline de `kj run` (el botón **Run plan** y el ▶ de cada card). Ese pipeline se retiró en la 5.0: ver [Migrar a la 5.0](/docs/es/v4/migration/).

## Cómo Funciona

El board lee ficheros JSON desde `~/.karajan/hu-stories/` y `~/.karajan/sessions/`. SQLite se usa como índice para consultas rápidas, si se elimina, se reconstruye desde los ficheros JSON en el siguiente arranque.

## Tablero compartido

Un equipo puede trabajar sobre un mismo tablero: sus HUs viven como GitHub Issues del repo (etiqueta `kj:hu`) y todos ven las mismas.

- **Activarlo**: `kj hu backend github` escribe `.karajan/board.yml` con el repo de `origin`. Ese fichero va en una PR; quien haga pull lo hereda.
- **Trabajar con él**: `kj hu list` lo lee, `kj hu move <HU> <estado>` cambia una HU. Cada HU tiene asignada a la persona que la tiene en marcha.
- **Verlo en el board**: el proyecto muestra un plan `github` con esas HUs y un aviso que explica que es el tablero compartido, con un enlace a sus issues. Desde la web es de solo lectura: lo que cuenta son las issues, y se cambian con `kj hu move`.

## Herramienta MCP

Disponible como herramienta MCP `kj_board`:
```
kj_board({ action: "start", port: 4000 })
kj_board({ action: "open" })
kj_board({ action: "status" })
kj_board({ action: "stop" })
```
