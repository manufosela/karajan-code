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

Karajan Code (`kj`) orquesta multiples agentes de IA a traves de un pipeline automatizado: generacion de codigo, analisis estatico, revision de codigo, testing y auditorias de seguridad — todo en un solo comando.

En lugar de ejecutar un agente de IA y revisar manualmente su output, `kj` encadena agentes con quality gates. El coder escribe codigo, SonarQube lo analiza, el reviewer lo revisa, y si hay problemas, el coder recibe otra oportunidad. Este bucle se repite hasta que el codigo es aprobado o se alcanza el limite de iteraciones.

**Caracteristicas principales:**
- **Pipeline multi-agente** con 11 roles configurables
- **4 agentes de IA soportados**: Claude, Codex, Gemini, Aider
- **Servidor MCP** con 15 herramientas — usa `kj` desde Claude, Codex o cualquier host compatible con MCP sin salir de tu agente. [Ver configuracion MCP](#servidor-mcp)
- **TDD obligatorio** — se exigen cambios en tests cuando se modifican ficheros fuente
- **Integracion con SonarQube** — analisis estatico con quality gates (requiere [Docker](#requisitos))
- **Perfiles de revision** — standard, strict, relaxed, paranoid
- **Tracking de presupuesto** — monitorizacion de tokens y costes por sesion con `--trace`
- **Automatizacion Git** — auto-commit, auto-push, auto-PR tras aprobacion
- **Gestion de sesiones** — pausa/reanudacion con deteccion fail-fast y limpieza automatica de sesiones expiradas
- **Sistema de plugins** — extiende con agentes custom via `.karajan/plugins/`
- **Checkpoints interactivos** — en lugar de matar tareas largas, pausa cada 5 minutos con un informe de progreso y te deja decidir: continuar, parar o ajustar el tiempo
- **Descomposicion de tareas** — triage detecta cuando una tarea debe dividirse y recomienda subtareas; con integracion Planning Game, crea cards vinculadas con bloqueo secuencial
- **Retry con backoff** — recuperacion automatica ante errores transitorios de API (429, 5xx) con backoff exponencial y jitter
- **Pipeline stage tracker** — vista de progreso acumulativo durante `kj_run` mostrando que stages estan completadas, en ejecucion o pendientes — tanto en CLI como via eventos MCP para renderizado en tiempo real en el host
- **Guardarrailes de observabilidad del planner** — telemetria continua de heartbeat/stall, proteccion configurable por silencio maximo (`session.max_agent_silence_minutes`) y limite duro de ejecucion (`session.max_planner_minutes`) para evitar bloqueos prolongados en `kj_plan`/planner
- **Standby por rate-limit** — cuando un agente alcanza limites de uso, Karajan parsea el tiempo de espera, espera con backoff exponencial y reanuda automaticamente en vez de fallar
- **Preflight handshake** — `kj_preflight` requiere confirmacion humana de la configuracion de agentes antes de ejecutar, previniendo que la IA cambie asignaciones silenciosamente
- **Config de 3 niveles** — sesion > proyecto > global con scoping de `kj_agents`
- **Mediacion inteligente del reviewer** — el scope filter difiere automaticamente issues del reviewer fuera de scope (ficheros no presentes en el diff) como deuda tecnica rastreada en vez de bloquear; Solomon media reviews estancados; el contexto diferido se inyecta en el prompt del coder
- **Integracion con Planning Game** — combina opcionalmente con [Planning Game](https://github.com/AgenteIA-Geniova/planning-game) para gestion agil de proyectos (tareas, sprints, estimacion) — como Jira, pero open-source y nativo XP

> **Mejor con MCP** — Karajan Code esta disenado para usarse como servidor MCP dentro de tu agente de IA (Claude, Codex, etc.). El agente envia tareas a `kj_run`, recibe notificaciones de progreso en tiempo real, y obtiene resultados estructurados — sin copiar y pegar.

## Requisitos

- **Node.js** >= 18
- **Docker** — necesario para el analisis estatico con SonarQube. Si no tienes Docker o no necesitas SonarQube, desactivalo con `--no-sonar` o `sonarqube.enabled: false` en la config
- Al menos un agente de IA instalado: Claude, Codex, Gemini o Aider

## Pipeline

```
triage? ─> researcher? ─> planner? ─> coder ─> refactorer? ─> sonar? ─> reviewer ─> tester? ─> security? ─> commiter?
```

| Rol | Descripcion | Por defecto |
|-----|-------------|-------------|
| **triage** | Director de pipeline — analiza la complejidad y activa roles dinamicamente | **On** |
| **researcher** | Investiga el contexto del codebase antes de planificar | Off |
| **planner** | Genera planes de implementacion estructurados | Off |
| **coder** | Escribe codigo y tests siguiendo metodologia TDD | **Siempre activo** |
| **refactorer** | Mejora la claridad del codigo sin cambiar comportamiento | Off |
| **sonar** | Ejecuta analisis estatico SonarQube y quality gates | On (si configurado) |
| **reviewer** | Revision de codigo con perfiles de exigencia configurables | **Siempre activo** |
| **tester** | Quality gate de tests y verificacion de cobertura | **On** |
| **security** | Auditoria de seguridad OWASP | **On** |
| **solomon** | Supervisor de sesion — monitoriza salud de iteraciones con 5 reglas (incl. reviewer overreach), media reviews estancados, escala ante anomalias | **On** |
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

## Inicio rapido

```bash
# Ejecutar una tarea con defaults (claude=coder, codex=reviewer, TDD)
kj run "Implementar autenticacion de usuario con JWT"

# Solo coder (sin revision)
kj code "Anadir validacion de inputs al formulario de registro"

# Solo reviewer (revisar diff actual)
kj review "Revisar los cambios de autenticacion"

# Generar un plan de implementacion
kj plan "Refactorizar la capa de base de datos para usar connection pooling"

# Pipeline completo con todas las opciones
kj run "Corregir inyeccion SQL critica en el endpoint de busqueda" \
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

**Variantes de revision**: `reviewer-strict`, `reviewer-relaxed`, `reviewer-paranoid` — seleccionables via flag `--mode` o config `review_mode`.

## Contribuir

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
npm install
npm test              # Ejecutar 1040+ tests con Vitest
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
