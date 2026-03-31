<p align="center">
  <img src="karajan-code-logo-small.png" alt="Karajan Code" width="180">
</p>

<h1 align="center">Karajan Code</h1>

<p align="center">
  Orquestador local multi-agente. TDD-first, basado en MCP, JavaScript vanilla.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/karajan-code"><img src="https://img.shields.io/npm/v/karajan-code.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/karajan-code"><img src="https://img.shields.io/npm/dw/karajan-code.svg" alt="npm downloads"></a>
  <a href="https://github.com/manufosela/karajan-code/actions"><img src="https://github.com/manufosela/karajan-code/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js"></a>
  <a href="https://github.com/manufosela/homebrew-tap"><img src="https://img.shields.io/badge/homebrew-tap-orange.svg" alt="Homebrew"></a>
</p>

<p align="center">
  <a href="../README.md">Read in English</a> · <a href="https://karajancode.com">Documentacion</a>
</p>

---

Tu describes lo que quieres construir. Karajan orquesta multiples agentes de IA para planificarlo, implementarlo, testearlo, revisarlo con SonarQube e iterar. Sin que tengas que supervisar cada paso.

## Que es Karajan?

Karajan es un orquestador de codigo local. Corre en tu maquina, usa tus proveedores de IA existentes (Claude, Codex, Gemini, Aider, OpenCode) y coordina un pipeline de agentes especializados que trabajan juntos en tu codigo.

No es un servicio en la nube. No es una extension de VS Code. Es una herramienta que instalas una vez y usas desde la terminal o como servidor MCP dentro de tu agente de IA.

El nombre viene de Herbert von Karajan, el director de orquesta que creia que las mejores orquestas estan formadas por grandes musicos independientes que saben exactamente cuando tocar y cuando escuchar. La misma idea, aplicada a agentes de IA.

## Por que no usar solo Claude Code?

Claude Code es excelente. Usalo para codificacion interactiva basada en sesiones.

Usa Karajan cuando quieras:

- **Un pipeline repetible y documentado** que corre igual cada vez
- **TDD por defecto.** Los tests se escriben antes de la implementacion, no despues
- **Integracion con SonarQube.** Quality gates como parte del flujo, no como algo secundario
- **Solomon como jefe del pipeline.** Cada rechazo del reviewer es evaluado por un supervisor que decide si es valido o solo ruido de estilo
- **Enrutamiento multi-proveedor.** Claude como coder, Codex como reviewer, o cualquier combinacion
- **Operacion zero-config.** Auto-detecta frameworks de test, arranca SonarQube, simplifica el pipeline para tareas triviales
- **Arquitectura de roles composable.** Comportamientos de agente definidos como ficheros markdown que viajan con tu proyecto
- **Local-first.** Tu codigo, tus claves, tu maquina. Ningun dato sale salvo que tu lo digas
- **Zero costes de API.** Karajan usa CLIs de agentes de IA (Claude Code, Codex, Gemini CLI), no APIs. Pagas tu suscripcion existente (Claude Pro, ChatGPT Plus), no tarifas por token

Si Claude Code es un programador de pares inteligente, Karajan es el pipeline CI/CD para desarrollo asistido por IA. Funcionan genial juntos: Karajan esta diseñado para usarse como servidor MCP dentro de Claude Code.

## Instalacion

**npm** (recomendado):
```bash
npm install -g karajan-code
```

**Homebrew** (macOS):
```bash
brew tap manufosela/tap
brew install karajan-code
```

**One-liner** (detecta SO, instala via npm):
```bash
curl -fsSL https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install-kj.sh | sh
```

**Docker** (sin Node.js):
```bash
docker run --rm -v $(pwd):/workspace karajan-code kj --version
```

`kj init` auto-detecta tus agentes instalados e instala RTK para optimizacion de tokens.

## Tres formas de usar Karajan

Karajan instala **tres comandos**: `kj`, `kj-tail` y `karajan-mcp`.

### 1. CLI: directamente desde terminal

Ejecuta Karajan directamente. Ves la salida completa del pipeline en tiempo real.

```bash
kj run "Crea una utilidad que valide numeros de DNI español, con tests"
kj code "Añade validacion de inputs al formulario de registro"     # Solo coder
kj review "Revisa los cambios de autenticacion"                     # Revisar diff actual
kj audit "Analisis completo de salud de este codebase"              # Auditoria solo-lectura
kj plan "Refactorizar la capa de base de datos"                     # Planificar sin codificar
```

### 2. MCP: dentro de tu agente de IA

Este es el caso de uso principal. Karajan corre como servidor MCP dentro de Claude Code, Codex o Gemini. Le pides algo a tu agente de IA y el delega el trabajo pesado al pipeline de Karajan.

```
Tu → Claude Code → kj_run (via MCP) → triage → coder → sonar → reviewer → tester → security
```

El servidor MCP se auto-registra durante `npm install`. Tu agente de IA ve 23 herramientas (`kj_run`, `kj_code`, `kj_review`, `kj_hu`, etc.) y las usa segun necesite.

**El problema**: cuando Karajan corre dentro de un agente de IA, pierdes visibilidad. El agente te muestra el resultado final, pero no las etapas del pipeline, iteraciones o decisiones de Solomon en tiempo real.

### 3. kj-tail: monitorizar desde otro terminal

**La herramienta compañera.** Abre un segundo terminal en el **mismo directorio del proyecto** donde esta trabajando tu agente de IA:

```bash
kj-tail
```

Veras la salida del pipeline en vivo (etapas, resultados, iteraciones, errores) tal como ocurren. La misma vista que ejecutar `kj run` directamente.

```
kj-tail                  # Seguir pipeline en tiempo real (por defecto)
kj-tail -v               # Verbose: incluir heartbeats de agente y presupuesto
kj-tail -t               # Mostrar timestamps
kj-tail -s               # Snapshot: mostrar log actual y salir
kj-tail -n 50            # Mostrar ultimas 50 lineas y seguir
kj-tail --help           # Todas las opciones
```

> **Importante**: `kj-tail` debe ejecutarse desde el mismo directorio donde el agente de IA esta trabajando. Lee `<proyecto>/.kj/run.log`, que se crea cuando Karajan arranca un pipeline via MCP.

[**Ver la demo completa del pipeline**](https://karajancode.com#demo): triage, arquitectura, TDD, SonarQube, code review, arbitraje de Solomon, auditoria de seguridad.

## El pipeline

```
hu-reviewer? → triage → discover? → architect? → planner? → coder → sonar? → impeccable? → reviewer → tester? → security? → solomon → commiter?
```

**15 roles**, cada uno ejecutado por el agente de IA que elijas:

| Rol | Que hace | Por defecto |
|-----|----------|-------------|
| **hu-reviewer** | Certifica historias de usuario antes de codificar (6 dimensiones, 7 antipatrones) | Auto (media/compleja) |
| **triage** | Clasifica complejidad, activa roles, auto-simplifica para tareas triviales | **On** |
| **discover** | Detecta huecos en requisitos (Mom Test, Wendel, JTBD) | Off |
| **architect** | Diseña la arquitectura de la solucion antes de planificar | Off |
| **planner** | Genera planes de implementacion estructurados | Off |
| **coder** | Escribe codigo y tests siguiendo metodologia TDD | **Siempre on** |
| **refactorer** | Mejora la claridad del codigo sin cambiar comportamiento | Off |
| **sonar** | Analisis estatico SonarQube con quality gate enforcement | On (auto-gestionado) |
| **impeccable** | Auditoria UI/UX para tareas frontend (a11y, rendimiento, theming) | Auto (frontend) |
| **reviewer** | Code review con perfiles de exigencia configurables | **Siempre on** |
| **tester** | Quality gate de tests y verificacion de cobertura | **On** |
| **security** | Auditoria de seguridad OWASP | **On** |
| **solomon** | Jefe del pipeline: evalua cada rechazo, anula bloqueos solo de estilo | **On** |
| **commiter** | Automatizacion de git commit, push y PR tras aprobacion | Off |
| **audit** | Analisis de salud del codebase solo-lectura (5 dimensiones, scores A-F) | Standalone |

## 5 agentes de IA soportados

| Agente | CLI | Instalacion |
|--------|-----|-------------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | Ver [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pipx install aider-chat` (o `pip3 install aider-chat`) |
| **OpenCode** | `opencode` | Ver [OpenCode docs](https://github.com/nicepkg/opencode) |

Mezcla y combina. Usa Claude como coder y Codex como reviewer. Karajan auto-detecta agentes instalados durante `kj init`.

## Servidor MCP (23 herramientas)

Tras `npm install -g karajan-code`, el servidor MCP se auto-registra en Claude y Codex. Config manual si es necesario:

```bash
# Claude: añadir a ~/.claude.json → "mcpServers":
# { "karajan-mcp": { "command": "karajan-mcp" } }

# Codex: añadir a ~/.codex/config.toml → [mcp_servers."karajan-mcp"]
# command = "karajan-mcp"
```

**23 herramientas** disponibles: `kj_run`, `kj_code`, `kj_review`, `kj_plan`, `kj_audit`, `kj_scan`, `kj_doctor`, `kj_config`, `kj_report`, `kj_resume`, `kj_roles`, `kj_agents`, `kj_preflight`, `kj_status`, `kj_init`, `kj_discover`, `kj_triage`, `kj_researcher`, `kj_architect`, `kj_impeccable`, `kj_hu`, `kj_skills`, `kj_suggest`.

Usa `kj-tail` en un terminal separado para ver lo que el pipeline esta haciendo en tiempo real (ver [Tres formas de usar Karajan](#tres-formas-de-usar-karajan)).

## La arquitectura de roles

Cada rol en Karajan esta definido por un fichero markdown: un documento plano que describe como debe comportarse el agente, que revisar y como es un buen output.

```
.karajan/roles/         # Overrides de proyecto (opcional)
~/.karajan/roles/       # Overrides globales (opcional)
templates/roles/        # Defaults built-in (incluidos en el paquete)
```

Puedes sobreescribir cualquier rol built-in o crear nuevos. Sin codigo. Los agentes leen los ficheros de rol y adaptan su comportamiento. Codifica las convenciones de tu equipo, reglas de dominio y estandares de calidad, y cada ejecucion de Karajan los aplica automaticamente.

Usa `kj roles show <rol>` para inspeccionar cualquier template.

## Zero-config por diseño

Karajan auto-detecta y auto-configura todo lo que puede:

- **TDD**: Detecta framework de tests para 12 lenguajes (vitest, jest, JUnit, pytest, go test, cargo test, y mas). Auto-activa TDD para tareas de codigo, lo salta para doc/infra
- **Bootstrap gate**: Valida todos los prerequisitos (repo git, remote, config, agentes, SonarQube) antes de ejecutar. Falla con instrucciones claras, nunca degrada silenciosamente
- **Injection guard**: Escanea diffs en busca de prompt injection antes del review de IA. Detecta directivas de override, Unicode invisible, payloads en comentarios sobredimensionados. Tambien como GitHub Action en cada PR
- **SonarQube**: Auto-arranca contenedor Docker, genera config si falta
- **Complejidad del pipeline**: Triage clasifica la tarea, las triviales saltan el loop del reviewer
- **Caidas de proveedor**: Reintentos en 500/502/503/504 con backoff (igual que rate limits)
- **Cobertura**: Fallos de quality gate solo por cobertura se tratan como advisory
- **HU Manager**: Las tareas complejas se descomponen automaticamente en historias de usuario formales con dependencias. Cada HU se ejecuta como su propio sub-pipeline con seguimiento de estado visible en el HU Board

Sin configuracion por proyecto requerida. Si quieres personalizar, la config se apila: sesion > proyecto > global.

## Por que JavaScript vanilla?

No es nostalgia ni cabezoneria. Es que llevo usando JavaScript desde 1997, cuando Brendan Eich lo creo en una semana y nos cambio la vida a los que haciamos webs. Conozco sus tripas, sus bugs, sus rarezas. Y se que quien conoce JS de verdad convierte esos bugs en features. TypeScript existe para que developers acostumbrados a lenguajes fuertemente tipados no entren en panico al ver JS. Respeto eso. Pero yo no lo necesito. Los tests son mi seguridad de tipos. JSDoc y un buen IDE son mi intellisense. Y no tener un compilador entre el codigo y yo es lo que me permite moverme a 57 releases en 45 dias sin miedo.

[Por que JavaScript vanilla: la version larga](why-vanilla-js.md)

## Compañeros recomendados

| Herramienta | Por que |
|-------------|---------|
| [**RTK**](https://github.com/rtk-ai/rtk) | Reduce consumo de tokens 60-90% en salidas de comandos Bash |
| [**Planning Game MCP**](https://github.com/AgenteIA-Geniova/planning-game-mcp) | Gestion agil de proyectos (tareas, sprints, estimacion), nativo XP |
| [**GitHub MCP**](https://github.com/modelcontextprotocol/servers/tree/main/src/github) | Crear PRs, gestionar issues directamente desde el agente |
| [**Chrome DevTools MCP**](https://github.com/anthropics/anthropic-quickstarts/tree/main/chrome-devtools-mcp) | Verificar cambios de UI visualmente tras modificar frontend |

## Contribuir

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
npm install
npm test              # Ejecutar ~2599 tests con Vitest
npm run validate      # Lint + test
```

Issues y pull requests bienvenidos. Si algo no funciona como esta documentado, [abre un issue](https://github.com/manufosela/karajan-code/issues). Es la contribucion mas util en esta fase.

## Enlaces

- [Web](https://karajancode.com) (tambien [kj-code.com](https://kj-code.com))
- [Documentacion completa](https://karajancode.com/docs/)
- [Changelog](../CHANGELOG.md)
- [Politica de seguridad](../SECURITY.md)
- [Licencia (AGPL-3.0)](../LICENSE)

---

Construido por [@manufosela](https://github.com/manufosela). Head of Engineering en Geniova Technologies, co-organizador de NodeJS Madrid, autor de [Liderazgo Afectivo](https://www.liderazgoafectivo.com). 90+ paquetes npm publicados.

### Contributors

- [@aitormf](https://github.com/aitormf) — Agente OpenCode (5o agente built-in)
- [@reiaguilera](https://github.com/reiaguilera) — Beta testing, propuestas de mejora y feedback de calidad
