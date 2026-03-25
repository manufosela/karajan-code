<p align="center">
  <img src="karajan-code-logo-small.png" alt="Karajan Code" width="200">
</p>

<h1 align="center">Karajan Code</h1>

<p align="center">
  Orquestador local multi-agente con TDD, SonarQube y revision de codigo automatizada.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/karajan-code"><img src="https://img.shields.io/npm/v/karajan-code.svg" alt="npm version"></a>
  <a href="https://github.com/manufosela/karajan-code/actions"><img src="https://github.com/manufosela/karajan-code/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js"></a>
</p>

<p align="center">
  <a href="../README.md">Read in English</a>
</p>

---

## Que es Karajan Code?

Karajan Code (`kj`) orquesta multiples agentes de IA a traves de un pipeline automatizado: generacion de codigo, analisis estatico, revision de codigo, testing y auditorias de seguridad. Todo en un solo comando.

En lugar de ejecutar un agente de IA y revisar manualmente su output, `kj` encadena agentes con quality gates. El coder escribe codigo, SonarQube lo analiza, el reviewer lo revisa, y si hay problemas, el coder recibe otra oportunidad. Este bucle se repite hasta que el codigo es aprobado o se alcanza el limite de iteraciones.

**Caracteristicas principales:**
- **Pipeline multi-agente** con 11 roles configurables
- **5 agentes de IA soportados**: Claude, Codex, Gemini, Aider, OpenCode
- **Servidor MCP** con 20 herramientas. Usa `kj` desde Claude, Codex o cualquier host compatible con MCP sin salir de tu agente. [Ver configuracion MCP](#servidor-mcp)
- **Bootstrap obligatorio.** Valida prerequisitos del entorno (git, remote, config, agentes, SonarQube) antes de cada ejecucion. Si algo falta, para con instrucciones claras
- **Guardia anti-inyeccion.** Escanea diffs antes de pasarlos a la IA: detecta directivas de override, Unicode invisible y payloads ocultos en comentarios. Tambien como GitHub Action en cada PR
- **TDD obligatorio.** Se exigen cambios en tests cuando se modifican ficheros fuente
- **Integracion con SonarQube.** Analisis estatico con quality gates (requiere [Docker](#requisitos))
- **Perfiles de revision.** standard, strict, relaxed, paranoid
- **Tracking de presupuesto.** Monitorizacion de tokens y costes por sesion con `--trace`
- **Automatizacion Git.** Auto-commit, auto-push, auto-PR tras aprobacion
- **Gestion de sesiones.** Pausa/reanudacion con deteccion fail-fast y limpieza automatica de sesiones expiradas
- **Sistema de plugins.** Extiende con agentes custom via `.karajan/plugins/`
- **Checkpoints interactivos.** En lugar de matar tareas largas, pausa cada 5 minutos con un informe de progreso y te deja decidir: continuar, parar o ajustar el tiempo
- **Descomposicion de tareas.** Triage detecta cuando una tarea debe dividirse y recomienda subtareas; con integracion Planning Game, crea cards vinculadas con bloqueo secuencial
- **Retry con backoff.** Recuperacion automatica ante errores transitorios de API (429, 5xx) con backoff exponencial y jitter
- **Pipeline stage tracker.** Vista de progreso acumulativo durante `kj_run` mostrando que stages estan completadas, en ejecucion o pendientes, tanto en CLI como via eventos MCP para renderizado en tiempo real en el host
- **Guardarrailes de observabilidad del planner.** Telemetria continua de heartbeat/stall, proteccion configurable por silencio maximo (`session.max_agent_silence_minutes`) y limite duro de ejecucion (`session.max_planner_minutes`) para evitar bloqueos prolongados en `kj_plan`/planner
- **Standby por rate-limit.** Cuando un agente alcanza limites de uso, Karajan parsea el tiempo de espera, espera con backoff exponencial y reanuda automaticamente en vez de fallar
- **Preflight handshake.** `kj_preflight` requiere confirmacion humana de la configuracion de agentes antes de ejecutar, previniendo que la IA cambie asignaciones silenciosamente
- **Config de 3 niveles.** Sesion > proyecto > global con scoping de `kj_agents`
- **Mediacion inteligente del reviewer.** El scope filter difiere automaticamente issues del reviewer fuera de scope (ficheros no presentes en el diff) como deuda tecnica rastreada en vez de bloquear; Solomon media reviews estancados; el contexto diferido se inyecta en el prompt del coder
- **Integracion con Planning Game.** Combina opcionalmente con [Planning Game](https://github.com/AgenteIA-Geniova/planning-game) para gestion agil de proyectos (tareas, sprints, estimacion). Como Jira, pero open-source y nativo XP

> **Mejor con MCP.** Karajan Code esta disenado para usarse como servidor MCP dentro de tu agente de IA (Claude, Codex, etc.). El agente envia tareas a `kj_run`, recibe notificaciones de progreso en tiempo real, y obtiene resultados estructurados. Sin copiar y pegar.

## Requisitos

- **Node.js** >= 18
- **Docker** (necesario para SonarQube). Si no lo necesitas, desactivalo con `--no-sonar` o `sonarqube.enabled: false`
- Al menos un agente de IA instalado: Claude, Codex, Gemini o Aider

## Pipeline

```
triage? ─> researcher? ─> planner? ─> coder ─> refactorer? ─> sonar? ─> reviewer ─> tester? ─> security? ─> commiter?
```

| Rol | Descripcion | Por defecto |
|-----|-------------|-------------|
| **triage** | Director de pipeline: analiza la complejidad y activa roles dinamicamente | **On** |
| **researcher** | Investiga el contexto del codebase antes de planificar | Off |
| **planner** | Genera planes de implementacion estructurados | Off |
| **coder** | Escribe codigo y tests siguiendo metodologia TDD | **Siempre activo** |
| **refactorer** | Mejora la claridad del codigo sin cambiar comportamiento | Off |
| **sonar** | Ejecuta analisis estatico SonarQube y quality gates | On (si configurado) |
| **reviewer** | Revision de codigo con perfiles de exigencia configurables | **Siempre activo** |
| **tester** | Quality gate de tests y verificacion de cobertura | **On** |
| **security** | Auditoria de seguridad OWASP | **On** |
| **solomon** | Supervisor de sesion: monitoriza salud de iteraciones con 5 reglas (incl. reviewer overreach), media reviews estancados, escala ante anomalias | **On** |
| **commiter** | Automatizacion de git commit, push y PR tras aprobacion | Off |

Los roles marcados con `?` son opcionales y se pueden activar por ejecucion o via config.

## Instalacion

### Desde npm (recomendado)

```bash
npm install -g karajan-code
kj init
```

### Desde codigo fuente

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
./scripts/install.sh
```

### Setup no interactivo (CI/automatizacion)

```bash
./scripts/install.sh \
  --non-interactive \
  --kj-home /ruta/a/.karajan \
  --sonar-host http://localhost:9000 \
  --sonar-token "$KJ_SONAR_TOKEN" \
  --coder claude \
  --reviewer codex \
  --run-doctor true
```

### Setup multi-instancia

Guias completas: [`docs/multi-instance.md`](multi-instance.md) | [`docs/install-two-instances.md`](install-two-instances.md)

```bash
./scripts/setup-multi-instance.sh
```

## Agentes soportados

| Agente | CLI | Instalacion |
|--------|-----|-------------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | Ver [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pipx install aider-chat` (o `pip3 install aider-chat`) |

`kj init` auto-detecta los agentes instalados. Si solo hay uno disponible, se asigna a todos los roles automaticamente.

## Tres formas de usar Karajan

Karajan instala **tres comandos**: `kj`, `kj-tail` y `karajan-mcp`.

### 1. CLI: directamente desde terminal

```bash
kj run "Implementar autenticacion de usuario con JWT"
kj code "Anadir validacion de inputs al formulario de registro"
kj review "Revisar los cambios de autenticacion"
kj plan "Refactorizar la capa de base de datos"
```

### 2. MCP: dentro de tu agente de IA

El caso de uso principal. Karajan corre como servidor MCP dentro de Claude Code, Codex o Gemini. El agente tiene acceso a 20 herramientas (`kj_run`, `kj_code`, `kj_review`, etc.) y delega el trabajo pesado al pipeline de Karajan.

```
Tu → Claude Code → kj_run (via MCP) → triage → coder → sonar → reviewer → tester → security
```

**El problema**: cuando Karajan corre dentro de un agente de IA, pierdes visibilidad. El agente te muestra el resultado final, pero no las etapas del pipeline, iteraciones o decisiones de Solomon en tiempo real.

### 3. kj-tail: monitorizar desde otro terminal

**La herramienta companera.** Abre un segundo terminal en el **mismo directorio del proyecto** donde esta trabajando tu agente de IA:

```bash
kj-tail
```

Veras la salida del pipeline en vivo (etapas, resultados, iteraciones, errores) tal como ocurren.

```bash
kj-tail                  # Seguir pipeline en tiempo real (por defecto)
kj-tail -v               # Verbose: incluir heartbeats de agente y presupuesto
kj-tail -t               # Mostrar timestamps
kj-tail -s               # Snapshot: mostrar log actual y salir
kj-tail -n 50            # Mostrar ultimas 50 lineas y seguir
kj-tail --help           # Todas las opciones
```

> **Importante**: `kj-tail` debe ejecutarse desde el mismo directorio donde el agente de IA esta trabajando. Lee `<proyecto>/.kj/run.log`, que se crea cuando Karajan arranca un pipeline via MCP.

**Flujo tipico:**

```
┌──────────────────────────┐    ┌──────────────────────────┐
│  Terminal 1               │    │  Terminal 2               │
│                           │    │                           │
│  $ claude                 │    │  $ kj-tail                │
│  > implementa la          │    │                           │
│    siguiente tarea        │    │  ├─ 📋 Triage: medium     │
│    prioritaria            │    │  ├─ 🔬 Researcher ✅      │
│                           │    │  ├─ 🧠 Planner ✅         │
│  (Claude llama a kj_run   │    │  ├─ 🔨 Coder ✅           │
│   via MCP, solo ves       │    │  ├─ 🔍 Sonar: OK         │
│   el resultado final)     │    │  ├─ 👁️ Reviewer ❌        │
│                           │    │  ├─ ⚖️ Solomon: 2 cond.   │
│                           │    │  ├─ 🔨 Coder (iter 2) ✅  │
│                           │    │  ├─ ✅ Review: APPROVED    │
│                           │    │  ├─ 🧪 Tester: passed     │
│                           │    │  └─ 🏁 Result: APPROVED   │
└──────────────────────────┘    └──────────────────────────┘
```

**Ejemplo con pipeline completo**, tarea compleja con todos los roles:

```
┌─ Terminal 1 ─────────────────────────────────────────────────────────────────┐
│                                                                              │
│  $ claude                                                                    │
│                                                                              │
│  > Construye una API REST para un sistema de reservas. Requisitos:           │
│  > - Express + TypeScript con validacion Zod en cada endpoint                │
│  > - Endpoints: POST /bookings, GET /bookings/:id,                           │
│  >   PATCH /bookings/:id/cancel                                              │
│  > - Una reserva tiene: id, guestName, roomType (standard|suite|penthouse),  │
│  >   checkIn, checkOut, status (confirmed|cancelled)                         │
│  > - Validar: checkOut posterior a checkIn, sin fechas pasadas,              │
│  >   roomType debe ser un valor valido del enum                              │
│  > - Cancelar devuelve 409 si ya esta cancelada                              │
│  > - Usa TDD. Ejecutalo con Karajan con architect y planner activos,         │
│  >   modo paranoid. Coder claude, reviewer codex.                            │
│                                                                              │
│  Claude llama a kj_run via MCP con:                                          │
│    --enable-architect --enable-researcher --enable-planner --mode paranoid    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌─ Terminal 2: kj-tail ────────────────────────────────────────────────────────┐
│                                                                              │
│  kj-tail v1.37.0 — .kj/run.log                                              │
│                                                                              │
│  ├─ 📋 Triage: medium (sw) — activando researcher, architect, planner        │
│  ├─ ⚙️ Preflight passed — all checks OK                                     │
│  ├─ 🔬 Researcher: 8 ficheros, 3 patrones, 5 restricciones                  │
│  ├─ 🏗️ Architect: diseno 3 capas (routes → service → validators)            │
│  ├─ 🧠 Planner: 6 pasos — tests primero, luego rutas, servicio, validadores │
│  │                                                                           │
│  ▶ Iteracion 1/5                                                             │
│  ├─ 🔨 Coder (claude): 3 endpoints + 18 tests                               │
│  ├─ 📋 TDD: PASS (3 src, 2 test)                                            │
│  ├─ 🔍 Sonar: Quality gate OK                                               │
│  ├─ 👁️ Reviewer (codex): REJECTED (2 blocking)                              │
│  │   "Falta 404 para GET booking inexistente"                                │
│  │   "Endpoint cancel sin test de idempotencia"                              │
│  ├─ ⚖️ Solomon: approve_with_conditions (2 condiciones)                     │
│  │   "Anadir respuesta 404 y test para GET /bookings/:id con id desconocido" │
│  │   "Anadir test: cancelar reserva ya cancelada devuelve 409, no 500"       │
│  │                                                                           │
│  ▶ Iteracion 2/5                                                             │
│  ├─ 🔨 Coder (claude): corregido — 22 tests                                 │
│  ├─ 📋 TDD: PASS                                                            │
│  ├─ 🔍 Sonar: OK                                                            │
│  ├─ 👁️ Reviewer (codex): APPROVED                                           │
│  ├─ 🧪 Tester: passed — cobertura 94%, 22 tests                             │
│  ├─ 🔒 Security: passed — 0 criticos, 1 bajo (helmet recomendado)           │
│  ├─ 📊 Audit: CERTIFIED (3 advertencias)                                    │
│  │                                                                           │
│  🏁 Resultado: APPROVED                                                      │
│     🔬 Investigacion: 8 ficheros, 3 patrones                                 │
│     🗺 Plan: 6 pasos (tests primero)                                         │
│     🧪 Cobertura: 94%, 22 tests                                              │
│     🔒 Seguridad: OK                                                         │
│     🔍 Sonar: OK                                                             │
│     💰 Presupuesto: $0.42 (claude: $0.38, codex: $0.04)                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Comandos CLI

Consulta la [documentacion completa de comandos](../README.md#cli-commands) en el README principal (ingles). Resumen:

| Comando | Descripcion |
|---------|-------------|
| `kj init` | Wizard interactivo de configuracion |
| `kj run <task>` | Pipeline completo: coder → sonar → reviewer |
| `kj code <task>` | Solo coder (sin revision) |
| `kj review <task>` | Solo reviewer (sobre diff actual) |
| `kj plan <task>` | Generar plan de implementacion |
| `kj scan` | Ejecutar analisis SonarQube |
| `kj doctor` | Verificar entorno (git, Docker, agentes, SonarQube) |
| `kj config` | Mostrar configuracion actual |
| `kj report` | Informes de sesion con tracking de presupuesto |
| `kj resume <id>` | Reanudar sesion pausada |
| `kj roles` | Inspeccionar roles y templates del pipeline |
| `kj sonar` | Gestionar contenedor Docker de SonarQube |

## Servidor MCP

Karajan Code expone un servidor MCP para integracion con cualquier host compatible (Claude, Codex, agentes custom).

Tras `npm install -g karajan-code`, el servidor MCP se auto-registra en las configs de Claude y Codex. Config manual:

```json
{
  "mcpServers": {
    "karajan-mcp": {
      "command": "karajan-mcp"
    }
  }
}
```

### Herramientas MCP

| Herramienta | Descripcion |
|-------------|-------------|
| `kj_init` | Inicializar config y SonarQube |
| `kj_doctor` | Verificar dependencias del sistema |
| `kj_config` | Mostrar configuracion |
| `kj_scan` | Ejecutar analisis SonarQube |
| `kj_run` | Ejecutar pipeline completo (con notificaciones de progreso en tiempo real) |
| `kj_resume` | Reanudar sesion pausada |
| `kj_report` | Leer informes de sesion (soporta `--trace`) |
| `kj_roles` | Listar roles o mostrar templates |
| `kj_code` | Modo solo coder |
| `kj_review` | Modo solo reviewer |
| `kj_plan` | Generar plan de implementacion con telemetria heartbeat/stall y diagnostico mas claro |

### MCPs complementarios recomendados

Karajan Code funciona perfectamente solo, pero combinarlo con estos servidores MCP le da a tu agente un entorno de desarrollo completo:

| MCP | Para que | Caso de uso |
|-----|----------|-------------|
| [**Planning Game MCP**](https://github.com/AgenteIA-Geniova/planning-game-mcp) | Puente MCP para [Planning Game](https://github.com/AgenteIA-Geniova/planning-game), gestor agil open-source (tareas, sprints, estimacion, XP). Solo necesario si usas Planning Game | `kj_run` con `--pg-task` obtiene contexto completo de la tarea y actualiza el estado al completar |
| [**GitHub MCP**](https://github.com/modelcontextprotocol/servers/tree/main/src/github) | Crear PRs, gestionar issues, leer repos desde el agente | Combinar con `--auto-push` para flujo completo: codigo → revision → push → PR |
| [**Serena**](https://github.com/oramasearch/serena) | Navegacion a nivel de simbolo (find references, go-to-definition) para proyectos JS/TS | Activar con `--enable-serena` para inyectar contexto de simbolos en prompts de coder/reviewer |
| [**Chrome DevTools MCP**](https://github.com/anthropics/anthropic-quickstarts/tree/main/chrome-devtools-mcp) | Automatizacion de navegador, screenshots, inspeccion de consola/red | Verificar cambios de UI visualmente tras modificar codigo frontend |

## Templates de roles

Cada rol tiene un template `.md` con instrucciones que el agente de IA sigue. Los templates se resuelven en orden de prioridad:

1. **Override de proyecto**: `.karajan/roles/<rol>.md` (en la raiz del proyecto)
2. **Override de usuario**: `$KJ_HOME/roles/<rol>.md`
3. **Built-in**: `templates/roles/<rol>.md` (incluido en el paquete)

Usa `kj roles show <rol>` para inspeccionar cualquier template. Crea un override de proyecto para personalizar el comportamiento por proyecto.

**Variantes de revision**: `reviewer-strict`, `reviewer-relaxed`, `reviewer-paranoid`, seleccionables via flag `--mode` o config `review_mode`.

## Contribuir

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
npm install
npm test              # Ejecutar 2044 tests con Vitest
npm run test:watch    # Modo watch
npm run validate      # Lint + test
```

- Tests: [Vitest](https://vitest.dev/)
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`)
- PRs: un solo proposito por PR, < 300 lineas cambiadas

## Enlaces

- [Web](https://karajancode.com) (tambien [kj-code.com](https://kj-code.com))
- [Changelog](../CHANGELOG.md)
- [Politica de seguridad](../SECURITY.md)
- [Licencia (AGPL-3.0)](../LICENSE)
- [Issues](https://github.com/manufosela/karajan-code/issues)
