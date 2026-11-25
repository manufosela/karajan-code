---
title: Dashboard HU Board
description: Dashboard web para visualizar historias de usuario y sesiones de Karajan Code.
---

## Qué es el HU Board?

Un dashboard web que visualiza todas las historias de usuario (HU) y sesiones del pipeline gestionadas por Karajan Code. Proporciona un tablero kanban, timeline de sesiones, puntuaciones de calidad y soporte multi-proyecto.

## En la práctica, desde tu agente

Más allá del kanban, el board tiene una vista **Governance**, el acta encadenada por hash del proyecto, en vivo. Cada decisión que toma el entorno (un deny, una excepción con su caducidad y su ámbito, un veredicto de revisión, un resellado del supervisor) aterriza ahí sellada, y cada entrada lleva la huella criptográfica de la anterior. Así, mientras tu agente trabaja, puedes leer, en un navegador, sin terminal, exactamente qué se decidió y por quién, con la certeza de que nadie reescribió el registro de ayer sin que se note.

El trabajo en paralelo también se ve. Una card que se trabaja en un carril de `kj worktree` lleva una etiqueta con el carril, su rama, sus commits por delante de la base y su PR. La vista Governance lista los carriles fuera del método: una rama que no nombra ninguna card y un carril cuya PR ya está mergeada, con el `kj worktree done <slug>` exacto que lo despeja. Todo sale de git y de GitHub (`kj worktree list`); el board guarda la respuesta un minuto y no almacena nada más.

La vista Governance muestra también las **reglas del método**, la misma lista que `kj gates`: las fijas con candado, y cada ajustable con su valor y quién lo puso (el valor por defecto, el proyecto, tú o una skill), más cualquier frase del CONTRIBUTING del proyecto que contradiga una regla fija. Un clic endurece una regla ajustable. Aflojarla es solo cosa tuya: el board te enseña el comando `kj gates set` para que lo teclees en tu terminal.

## Bajo el capó, pruébalo tú mismo

El acta es un fichero plano de solo-añadido donde cada línea liga la anterior:

```sh
cat .karajan/policy-decisions.jsonl   # una decisión JSON por línea; cada una lleva un hash "prev"
kj policy report                      # lo mismo, como informe legible (una cadena rota sale con exit 1)
kj policy anchor                      # re-verifica TODA la cadena y sella su head-hash en git
```

Una vez commiteado el head-hash (`kj policy anchor` escribe `.karajan/policy-anchor.json`), reescribir el pasado obliga a reescribir también la historia del repo, y eso se nota.

## Inicio Rápido

### Arrancarlo
Las dependencias del board vienen con karajan-code, así que no se instala nada más:
```bash
kj board start
```

### Con Docker (desde un clon del repo)
El paquete npm no lleva los ficheros de Docker; están en el repositorio:
```bash
cd packages/hu-board && docker compose up -d
```

### Desde el CLI
```bash
kj board start    # Iniciar el dashboard
kj board stop     # Detenerlo
kj board status   # Comprobar si está corriendo
kj board open     # Abrir en el navegador
```

## Configuración

Viene activado; este es el bloque, y `enabled: false` lo apaga (`kj board start --force` lo arranca igualmente):
```yaml
hu_board:
  enabled: true
  port: 4000
```

O activar durante el setup:
```bash
kj init  # responde sí a "Enable the HU Board" (el valor por defecto)
```

## Características

- **Tablero Kanban**: Historias en tres columnas (Pending → Running → Done)
- **Puntuaciones de Calidad**: Puntuaciones en 6 dimensiones con barras de progreso visuales
- **Timeline de Sesiones**: Desglose etapa por etapa con duraciones
- **Multi-Proyecto**: Auto-descubre todos los proyectos desde ~/.karajan/
- **Auto-Sincronización**: Vigila ficheros JSON para actualizaciones en tiempo real
- **Tema Oscuro**: Coincide con el diseño de Karajan Code
- **Fallback de Puerto**: Arranca en el puerto 4000 por defecto; prueba automáticamente del 4001 al 4010 si el puerto primario está ocupado
- **Carriles y Gobierno**: cada card muestra su carril, rama, commits por delante y PR; la vista de Gobierno lista los carriles fuera del método

### Páginas Usage y Accounts

Dos páginas se abren desde la cabecera del board. **Usage** (`/usage.html`) suma cada llamada a un agente que lanzó kj, por proyecto y cuenta, agrupada por día, mes, año o total, con exportación a CSV por proyecto y mes. **Accounts** (`/accounts.html`) muestra los logins de proveedor, su orden y su ritmo, y no lleva nunca una clave. Qué leen y qué no registra nunca kj: [Observabilidad y veracidad de las reviews](/docs/es/guides/observability/).

Hasta la 4.x el board podía lanzar también el pipeline de `kj run` (el botón **Run plan**). Ese pipeline se retiró en la 5.0: ver [Migrar a la 5.0](/docs/es/v4/migration/).

### Arrancar una card desde el board (▶)

Cada card pendiente sin carril tiene un ▶. Al confirmar, el board ejecuta `kj hu start <id> --code` en el proyecto:

1. kj comprueba la card. Si no existe o la tiene otra persona, no se crea nada.
2. Abre el carril de la card, `feat/<id>-<slug>`, desde `origin/<base>`, ya con tu identidad y el Sentinel dentro.
3. Pasa la card a en marcha, reservada a tu nombre.
4. El coder que declaraste en tu panel la escribe ahí (`kj code --card <id>`), y su log se abre en el board.

La revisión y el commit siguen siendo tuyos o de tu agente, dentro del carril. Una card que ya tiene carril no se arranca otra vez: el board te dice dónde está. Desde la terminal es lo mismo con `kj hu start <id> [slug]`, y `--code` para que el coder la escriba. Si la card ya tiene un carril, uno cuya rama lleva su id o su referencia (una card del Planning Game, por ejemplo), `kj hu start` arranca la card en ese carril en vez de abrir otro; si tiene más de uno, se para y los nombra.

## Cómo Funciona

El board lee los ficheros de sesión de `~/.karajan/sessions/` y los de plan de `~/.karajan/plans/` y `<proyecto>/.karajan-shared/plans/` (un tablero compartido lee sus issues de GitHub). SQLite es solo un índice: cada escaneo completo lo vacía y lo reconstruye desde esos ficheros.

## Tablero compartido

Un equipo puede trabajar sobre un mismo tablero: sus HUs viven como GitHub Issues del repo (etiqueta `kj:hu`) y todos ven las mismas.

- **Activarlo**: `kj hu backend github` escribe `.karajan/board.yml` con el repo de `origin`. Ese fichero va en una PR; quien haga pull lo hereda.
- **Trabajar con él**: `kj hu list` lo lee, `kj hu move <HU> <estado>` cambia una HU. Cada HU queda asignada a la persona que la tiene en marcha.
- **Verlo en el board**: el proyecto muestra un plan `github` con esas HUs y un aviso que explica que es el tablero compartido, con un enlace a sus issues. Desde la web es de solo lectura: lo que cuenta son las issues, y se cambian con `kj hu move`.

## Herramienta MCP

Disponible como herramienta MCP `kj_board`:
```
kj_board({ action: "start", port: 4000 })
kj_board({ action: "status" })
kj_board({ action: "stop" })
```
