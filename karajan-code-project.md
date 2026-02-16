# Karajan Code - Documento de Proyecto

**Nombre:** Karajan Code
**Comando:** `kj`
**Repositorio:** `karajan-code`

## 1. Descripcion del Proyecto

### Que hace

**Karajan Code** es un CLI local que orquesta dos agentes de IA (uno codifica, otro revisa) en un loop automatico hasta que el codigo cumple los estandares de calidad definidos por el usuario. Como un director de orquesta, `kj` coordina a los "musicos" (IAs) para que el resultado final sea armonioso. Todo se ejecuta en local, sin necesidad de subir codigo a un repositorio remoto hasta que este completamente revisado y aprobado.

### Para quien

Desarrolladores que ya usan herramientas de IA por suscripcion (Claude Pro/Max, OpenAI Plus/Pro, Google AI Pro/Ultra) y quieren:
- Automatizar el ciclo coder/reviewer sin intervencion manual
- Evitar round-trips innecesarios a GitHub (push → review → fix → push)
- Que la PR llegue limpia al repositorio, ya revisada y corregida

### Que problema resuelve

**Flujo actual (con GitHub Actions):**
```
Claude codea → push → PR → OpenAI revisa (GH Action) → comentarios →
Claude lee comentarios → fix → push → OpenAI revisa otra vez → ... → OK
```
Problemas: multiples pushes intermedios, historial de commits sucio, dependencia de CI remoto, latencia de red.

**Flujo con Karajan Code:**
```
kj run "tarea" → Coder (IA 1) implementa en local →
SonarQube escanea (bugs, vulnerabilidades, code smells) →
Si SonarQube falla → Coder corrige automaticamente → SonarQube re-escanea → ... →
SonarQube pasa → Reviewer (IA 2) revisa (logica, diseno, tests) →
Si hay comentarios → Coder corrige → SonarQube → Reviewer → ... →
Reviewer aprueba → push unico → PR limpia
```

### Funcionalidades principales

#### 1. Orquestacion multi-agente configurable
- El usuario elige que 2 IAs usar: una para codificar, otra para revisar
- Configuracion via `config.yml` o flags del CLI
- Soporte para: Claude Code, Codex CLI, Gemini CLI, Aider

#### 2. Analisis estatico con SonarQube (integrado)
- `kj init` levanta automaticamente un contenedor Docker con SonarQube Community Edition
- Tras cada iteracion del coder, SonarQube escanea el codigo antes de pasarlo al reviewer
- Si SonarQube detecta bugs, vulnerabilidades o code smells, el coder los corrige primero
- El reviewer recibe codigo ya limpio de issues objetivos y se enfoca en logica/diseno
- SonarQube actua como "primer filtro objetivo" que no consume turnos del reviewer

#### 3. Loop automatico de code review
- El CLI envia la tarea al coder
- Cuando el coder termina, SonarQube escanea el resultado
- Si SonarQube falla → coder corrige → SonarQube re-escanea (sub-loop)
- Si SonarQube pasa → genera diff y lo envia al reviewer con reglas
- Si el reviewer tiene comentarios → coder corrige → SonarQube → reviewer (loop principal)
- Repite hasta aprobacion o limite de iteraciones

#### 4. Modos de review configurables
- **paranoid**: Revisa todo - seguridad, rendimiento, estilo, tests, accesibilidad, documentacion
- **strict**: Seguridad + bugs + rendimiento + tests
- **standard**: Seguridad + bugs criticos + tests
- **relaxed**: Solo seguridad y bugs criticos
- **custom**: El usuario define sus propias reglas en un `.md`

#### 5. Review rules personalizables
- Fichero `review-rules.md` con instrucciones para el reviewer
- Puede incluir: reglas de estilo, patrones prohibidos, requisitos de tests, etc.
- Se inyecta como parte del prompt del reviewer

#### 6. Generacion de reporte
- Cada iteracion genera un log estructurado
- Al final: resumen de cambios, issues encontrados/corregidos, metricas
- Exportable como markdown (`review-report.md`)

#### 7. Integracion con Planning Game MCP (opcional)
- Puede leer tareas del Planning Game para obtener contexto
- Actualiza el estado de la tarea al completar
- Registra el plan de implementacion

#### 8. Git automation (opcional, post-aprobacion)
- Crear rama, commit, push
- Crear PR via `gh` CLI
- Solo cuando el reviewer da OK

### Comandos del CLI

| Comando | Descripcion | Coder | SonarQube | Reviewer | Loop |
|---------|-------------|:-----:|:---------:|:--------:|:----:|
| `kj run "tarea"` | Loop completo: coder + sonar + reviewer hasta OK | si | si | si | si |
| `kj code "tarea"` | Solo codificar, sin analisis ni review | si | no | no | no |
| `kj scan` | Solo ejecutar SonarQube sobre el codigo actual | no | si | no | no |
| `kj review` | Solo reviewer sobre el diff actual (sin sonar) | no | no | si | no |
| `kj plan "tarea"` | Solo generar plan de implementacion, sin codear | si (plan) | no | no | no |
| `kj init` | Setup: genera config, review-rules, levanta SonarQube Docker | - | setup | - | - |
| `kj doctor` | Verifica entorno: CLIs, Docker, SonarQube, versiones | - | check | - | - |
| `kj report` | Muestra el reporte de la ultima sesion | - | - | - | - |
| `kj report --list` | Lista reportes anteriores | - | - | - | - |
| `kj config` | Muestra la configuracion actual | - | - | - | - |
| `kj config --edit` | Abre `kj.config.yml` en el editor por defecto | - | - | - | - |

#### Flags comunes

```bash
# Overrides de config.yml via flags
kj run "tarea" --coder claude --reviewer codex --mode paranoid
kj run "tarea" --max-iterations 3
kj run "tarea" --dry-run              # Simula sin ejecutar
kj run "tarea" --no-sonar             # Saltar SonarQube en este run

# Solo SonarQube
kj scan                               # Escanea el proyecto actual
kj scan --fix                         # Escanea y pide al coder que corrija

# Integracion con Planning Game
kj run --task PLN-TSK-0155            # Lee tarea del Planning Game

# Git post-aprobacion
kj run "tarea" --auto-commit --auto-push --auto-pr
```

### Roles / Permisos

No hay sistema de permisos como tal. El CLI se ejecuta con los permisos del usuario local. Los agentes de IA heredan los permisos que tengan configurados (sandbox mode, yolo mode, etc.).

### Integraciones externas

| Integracion | Tipo | Proposito |
|-------------|------|-----------|
| Claude Code CLI | Subprocess | Agente coder/reviewer |
| Codex CLI | Subprocess | Agente coder/reviewer |
| Gemini CLI | Subprocess | Agente coder/reviewer |
| Aider | Subprocess | Agente coder/reviewer |
| SonarQube CE | Docker container | Analisis estatico (server). Se levanta con `kj init` |
| sonar-scanner | Docker container | Scanner que envia codigo a SonarQube para analisis |
| Docker | Requisito | Necesario para SonarQube server y scanner |
| Git / GitHub CLI | Subprocess | Commit, push, PR |
| Planning Game MCP | API (opcional) | Leer tareas, actualizar estado |

---

## 2. Referencia de CLIs soportados

### Claude Code (Anthropic)

| Aspecto | Detalle |
|---------|---------|
| **Comando headless** | `claude -p "prompt"` |
| **Suscripcion** | Pro ($20/mes) / Max ($100-200/mes) |
| **Output formats** | `text`, `json`, `stream-json` |
| **Continuar sesion** | `--continue` (ultima) o `--resume SESSION_ID` |
| **Auto-aprobar tools** | `--allowedTools "Bash,Read,Edit"` |
| **Modelo** | `--model` para elegir modelo |
| **System prompt** | `--append-system-prompt "..."` o `--system-prompt "..."` |
| **JSON Schema** | `--json-schema '{...}'` para output estructurado |
| **SDK** | Agent SDK (Python/TypeScript) para control programatico |

```bash
# Ejemplo basico
claude -p "Implementa la funcion X" --allowedTools "Read,Edit,Bash"

# Con output JSON
claude -p "Resume el proyecto" --output-format json | jq -r '.result'

# Continuar conversacion
session_id=$(claude -p "Revisa el codigo" --output-format json | jq -r '.session_id')
claude -p "Ahora corrige los issues" --resume "$session_id"

# Con JSON Schema
claude -p "Extrae funciones" --output-format json \
  --json-schema '{"type":"object","properties":{"functions":{"type":"array","items":{"type":"string"}}}}'
```

### Codex CLI (OpenAI)

| Aspecto | Detalle |
|---------|---------|
| **Comando headless** | `codex exec "prompt"` |
| **Suscripcion** | Plus ($20/mes) / Pro ($200/mes) |
| **Output formats** | texto (default), `--json` (JSONL stream) |
| **Continuar sesion** | `codex exec resume --last` o `resume SESSION_ID` |
| **Auto-aprobar** | `--full-auto` (permite ediciones) |
| **Sandbox** | `--sandbox danger-full-access` (entornos controlados) |
| **Output a fichero** | `-o path` o `--output-last-message path` |
| **Output schema** | `--output-schema ./schema.json` |
| **SDK** | `@openai/codex-sdk` (TypeScript/Node.js) |

```bash
# Ejemplo basico
codex exec "Implementa la funcion X"

# Con JSON output
codex exec --json "resume la estructura" | jq

# Resultado a fichero
codex exec "genera release notes" -o release-notes.md

# Continuar sesion anterior
codex exec resume --last "corrige los issues encontrados"

# Con output schema
codex exec "extrae metadata" --output-schema ./schema.json -o ./output.json
```

### Gemini CLI (Google)

| Aspecto | Detalle |
|---------|---------|
| **Comando headless** | `gemini -p "prompt"` o `gemini "prompt"` |
| **Suscripcion** | Gratis (limitado) / Pro / Ultra |
| **Output formats** | `text`, `json`, `stream-json` |
| **Auto-aprobar** | `--yolo` / `-y` |
| **Modelo** | `--model` / `-m` |
| **System prompt** | Variable `GEMINI_SYSTEM_MD` |
| **Contexto** | 1M tokens de ventana de contexto |
| **Directorios extra** | `--include-directories` |

```bash
# Ejemplo basico
gemini -p "Implementa la funcion X"

# Con output JSON (parseable)
gemini -p "Resume el proyecto" --output-format json

# Streaming JSON (eventos en tiempo real)
gemini -p "Revisa el codigo" --output-format stream-json > events.jsonl

# Con auto-aprobacion
gemini -p "Refactoriza el modulo auth" --yolo

# Piping de entrada
cat src/auth.js | gemini -p "Revisa este codigo por vulnerabilidades"
```

### Aider (Open Source)

| Aspecto | Detalle |
|---------|---------|
| **Comando headless** | `aider --message "prompt" ficheros...` |
| **Suscripcion** | Gratis (requiere API keys propias) |
| **Auto-aprobar** | `--yes` |
| **Auto-commits** | `--auto-commits` (activado por default) |
| **Dry run** | `--dry-run` |
| **Modelo** | Soporta 100+ modelos via API keys |
| **Ficheros** | Se especifican como argumentos posicionales |
| **API Python** | `from aider.coders import Coder` (no oficial) |

```bash
# Ejemplo basico
aider --message "anade docstrings" src/auth.js

# Sin commits automaticos
aider --message "refactoriza" --no-auto-commits src/*.js

# Batch sobre multiples ficheros
for FILE in src/*.py; do
    aider --message "anade type hints" "$FILE"
done
```

---

## 3. SonarQube - Arquitectura y Setup

### Como funciona

SonarQube se compone de dos piezas:
1. **SonarQube Server** (Community Edition) - Motor de analisis, corre como contenedor Docker persistente
2. **sonar-scanner** - Cliente que escanea el codigo y envia resultados al server

Karajan Code gestiona ambos automaticamente:

```
kj init → Docker pull sonarqube:community + sonar-scanner-cli
        → docker run sonarqube (puerto 9000, persistente)
        → Crea proyecto default en SonarQube
        → Genera token de acceso
        → Guarda config en kj.config.yml
```

### Setup automatico (`kj init`)

```bash
$ kj init

  Karajan Code - Setup

  Creating kj.config.yml... done
  Creating review-rules.md... done

  Setting up SonarQube...
    Checking Docker... ✓ Docker v27.1.0
    Pulling sonarqube:community... done
    Starting SonarQube server (port 9000)... done
    Waiting for SonarQube to be ready... ✓ (took 45s)
    Creating project "karajan-default"... done
    Generating access token... done
    Saving SonarQube config... done

  SonarQube is running at http://localhost:9000
  Ready to conduct.
```

### Docker Compose gestionado por kj

`kj init` genera un `docker-compose.sonar.yml` en `~/.karajan/`:

```yaml
# ~/.karajan/docker-compose.sonar.yml (auto-generado por kj init)
services:
  sonarqube:
    image: sonarqube:community
    container_name: karajan-sonarqube
    ports:
      - "9000:9000"
    volumes:
      - karajan_sonar_data:/opt/sonarqube/data
      - karajan_sonar_logs:/opt/sonarqube/logs
      - karajan_sonar_extensions:/opt/sonarqube/extensions
    environment:
      - SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true
    restart: unless-stopped

volumes:
  karajan_sonar_data:
  karajan_sonar_logs:
  karajan_sonar_extensions:
```

### Como se ejecuta el scan en el loop

Dentro del loop de `kj run`, tras cada iteracion del coder:

```bash
# 1. Ejecuta sonar-scanner via Docker (sin instalar nada en el host)
docker run --rm \
  -v "$(pwd):/usr/src" \
  --network="host" \
  -e SONAR_HOST_URL="http://localhost:9000" \
  -e SONAR_TOKEN="$KJ_SONAR_TOKEN" \
  -e SONAR_SCANNER_OPTS="-Dsonar.projectKey=$PROJECT_KEY" \
  sonarsource/sonar-scanner-cli

# 2. Consulta resultados via API de SonarQube
curl -s -u "$KJ_SONAR_TOKEN:" \
  "http://localhost:9000/api/issues/search?projectKeys=$PROJECT_KEY&statuses=OPEN"

# 3. Si hay issues → genera reporte → coder los corrige → re-scan
# 4. Si no hay issues → pasa al reviewer
```

### Resultados que se pasan al reviewer

Cuando SonarQube pasa, sus metricas se incluyen en el contexto del reviewer:

```
SonarQube Analysis: PASSED
- Bugs: 0
- Vulnerabilities: 0
- Code Smells: 2 (minor, below threshold)
- Coverage: 85%
- Duplications: 1.2%
```

Esto permite al reviewer enfocarse en logica y diseno, no en issues que SonarQube ya validó.

### Configuracion SonarQube en kj.config.yml

```yaml
# SonarQube settings
sonarqube:
  enabled: true                        # Activar/desactivar SonarQube en el loop
  host: http://localhost:9000          # URL del server
  token: null                          # Se genera automaticamente en kj init
  quality_gate: true                   # Fallar si no pasa el Quality Gate
  fail_on:                             # Que severidades bloquean el loop
    - BLOCKER
    - CRITICAL
  ignore_on:                           # Que severidades se ignoran
    - INFO
  max_scan_retries: 3                  # Veces que el coder intenta corregir antes de fallar
```

### Gestion del contenedor

```bash
kj sonar status          # Estado del contenedor SonarQube
kj sonar start           # Arranca el contenedor si esta parado
kj sonar stop            # Para el contenedor
kj sonar restart         # Reinicia el contenedor
kj sonar logs            # Muestra logs del contenedor
kj sonar open            # Abre http://localhost:9000 en el navegador
```

---

## 4. Decisiones tecnicas

### Stack propuesto

| Componente | Tecnologia | Justificacion |
|------------|------------|---------------|
| **Runtime** | Node.js >= 20 | Mismo ecosistema que Planning Game MCP, async nativo, buen manejo de subprocesos |
| **Lenguaje** | JavaScript (ES Modules) + JSDoc + `.d.ts` | Sin build step, tipos en editor via JSDoc, consistencia con Planning Game MCP |
| **CLI framework** | Commander.js o yargs | Maduro, ligero, buena DX |
| **Config** | YAML (js-yaml) | Legible, flexible, estandar para configs |
| **Subprocesos** | `child_process.spawn` / `execa` | Para invocar los CLIs de IA y Docker |
| **Output parsing** | Streams nativos + JSONL parser | Para leer output en tiempo real |
| **Logging** | pino o winston | Logs estructurados para debug |
| **Template prompts** | Handlebars o template literals | Prompts dinamicos con variables |
| **Docker** | Docker Engine + Compose | Para SonarQube server y sonar-scanner |
| **Tests** | Vitest | Consistencia con Planning Game MCP |

### Repositorio

- Repo separado: `karajan-code`
- Estructura monorepo no necesaria al inicio
- Publicable como paquete npm para instalacion global: `npm install -g karajan-code`
- Comando binario: `kj`

### Base de datos

**No necesita base de datos.** Todo es efimero por sesion:

| Dato | Almacenamiento |
|------|---------------|
| Configuracion | `config.yml` en el proyecto del usuario |
| Review rules | `review-rules.md` en el proyecto del usuario |
| Reportes de sesion | Ficheros `.md` generados en carpeta temporal o configurable |
| Logs | Stdout/stderr + fichero de log opcional |
| Estado de sesion | En memoria durante la ejecucion |

Si en el futuro se quiere persistir historial de reviews, un SQLite local seria suficiente.

### Estructura de directorios propuesta

```
karajan-code/
├── src/
│   ├── cli.js                 # Entry point del CLI (comando kj)
│   ├── commands/
│   │   ├── run.js             # kj run - loop completo
│   │   ├── code.js            # kj code - solo coder
│   │   ├── scan.js            # kj scan - solo SonarQube
│   │   ├── review.js          # kj review - solo reviewer
│   │   ├── plan.js            # kj plan - solo plan
│   │   ├── init.js            # kj init - setup inicial + SonarQube Docker
│   │   ├── doctor.js          # kj doctor - verificacion entorno
│   │   ├── report.js          # kj report - ver reportes
│   │   ├── config.js          # kj config - ver/editar config
│   │   └── sonar.js           # kj sonar - gestion contenedor SonarQube
│   ├── orchestrator.js        # Loop principal de orquestacion
│   ├── config.js              # Carga y validacion de config
│   ├── agents/
│   │   ├── base-agent.js      # Interfaz comun para todos los agentes
│   │   ├── claude-agent.js    # Adaptador Claude Code CLI
│   │   ├── codex-agent.js     # Adaptador Codex CLI
│   │   ├── gemini-agent.js    # Adaptador Gemini CLI
│   │   └── aider-agent.js     # Adaptador Aider CLI
│   ├── sonar/
│   │   ├── sonar-manager.js   # Gestion del contenedor Docker (start/stop/status)
│   │   ├── sonar-scanner.js   # Ejecutar scans via Docker sonar-scanner-cli
│   │   ├── sonar-api.js       # Consultar resultados via API REST de SonarQube
│   │   └── sonar-report.js    # Formatear resultados para el coder/reviewer
│   ├── review/
│   │   ├── review-loop.js     # Logica del loop coder/sonar/reviewer
│   │   ├── diff-generator.js  # Genera diffs para el reviewer
│   │   └── report.js          # Genera reportes finales
│   ├── prompts/
│   │   ├── coder.js           # Templates de prompts para el coder
│   │   ├── coder-sonar.js     # Templates para correcciones SonarQube
│   │   └── reviewer.js        # Templates de prompts para el reviewer
│   └── utils/
│       ├── process.js         # Helpers para subprocesos
│       ├── docker.js          # Helpers para Docker
│       ├── git.js             # Helpers para git
│       └── logger.js          # Logger
├── types/
│   └── index.d.ts             # Definiciones de tipos (.d.ts)
├── templates/
│   ├── kj.config.yml          # Config de ejemplo
│   ├── review-rules.md        # Review rules de ejemplo
│   └── docker-compose.sonar.yml  # Docker Compose para SonarQube
├── tests/
├── jsconfig.json              # Config para que VSCode lea JSDoc como tipos
├── package.json
└── README.md
```

---

## 5. Infraestructura CI/CD

### Que se necesita en CI/CD del propio proyecto

| Herramienta | Proposito |
|-------------|-----------|
| GitHub Actions | CI para tests y linting |
| Vitest | Tests unitarios e integracion |
| ESLint + Prettier | Linting y formato |
| npm publish (futuro) | Publicar como paquete global |

### Dependencias del proyecto

```json
{
  "name": "karajan-code",
  "type": "module",
  "bin": {
    "kj": "./src/cli.js"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "js-yaml": "^4.1.0",
    "execa": "^9.0.0",
    "pino": "^9.0.0",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "vitest": "^4.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.4.0"
  }
}
```

### Requisitos del sistema (para el usuario que instala el CLI)

#### Obligatorios

| Requisito | Version minima | Como verificar |
|-----------|---------------|----------------|
| **Node.js** | >= 20.0.0 | `node --version` |
| **npm** | >= 10.0.0 | `npm --version` |
| **Git** | >= 2.30.0 | `git --version` |
| **Docker** | >= 24.0.0 | `docker --version` |
| **Docker Compose** | >= 2.20.0 | `docker compose version` |
| **Al menos 2 CLIs de IA instalados** | - | Ver tabla abajo |

> **Nota sobre Docker:** SonarQube y sonar-scanner se ejecutan como contenedores Docker.
> No se necesita instalar Java, SonarQube ni sonar-scanner en el host.
> `kj init` gestiona todo automaticamente.

#### CLIs de IA (al menos 2 de estos)

| CLI | Instalacion | Verificar | Requiere |
|-----|-------------|-----------|----------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | `claude --version` | Suscripcion Anthropic Pro/Max |
| **Codex CLI** | `npm install -g @openai/codex` | `codex --version` | Suscripcion OpenAI Plus/Pro |
| **Gemini CLI** | `npm install -g @anthropic-ai/gemini-cli` o `npx @anthropic-ai/gemini-cli` | `gemini --version` | Cuenta Google (gratis/Pro/Ultra) |
| **Aider** | `pip install aider-chat` | `aider --version` | API keys propias |

#### Opcionales

| Requisito | Proposito | Verificar |
|-----------|-----------|-----------|
| **GitHub CLI (gh)** | Crear PRs automaticamente | `gh --version` |
| **jq** | Parsing de JSON en scripts | `jq --version` |

### Verificacion al instalar (`postinstall` o `init`)

El CLI incluye `kj doctor` para verificar el entorno:

```bash
$ kj doctor

  Karajan Code - System Check

  System requirements:
    ✓ Node.js v22.1.0 (>= 20.0.0)
    ✓ npm v10.8.0 (>= 10.0.0)
    ✓ Git v2.43.0 (>= 2.30.0)
    ✓ Docker v27.1.0
    ✓ Docker Compose v2.29.0

  AI CLIs:
    ✓ Claude Code v1.0.33 (authenticated)
    ✓ Codex CLI v1.2.0 (authenticated)
    ✗ Gemini CLI not found
    ✗ Aider not found
    2/4 available (minimum 2 required) ✓

  SonarQube:
    ✓ Container karajan-sonarqube running
    ✓ Server reachable at http://localhost:9000
    ✓ Scanner image sonarsource/sonar-scanner-cli available

  Optional tools:
    ✓ GitHub CLI v2.60.0 (authenticated)
    ✓ jq v1.7.1

  All checks passed. Ready to conduct.
```

---

## 6. Ejemplo de uso

```bash
# Setup inicial (genera config + levanta SonarQube Docker)
kj init
# → Genera kj.config.yml y review-rules.md
# → Pull sonarqube:community + sonar-scanner-cli
# → Arranca SonarQube en http://localhost:9000

# Loop completo: coder + reviewer hasta OK
kj run "Implementa autenticacion JWT en src/auth.ts"

# Con overrides
kj run "Fix bug en el modulo de pagos" --coder claude --reviewer codex --mode paranoid

# Solo codificar (sin review)
kj code "Anade tests para el modulo de auth"

# Solo escanear con SonarQube
kj scan

# Solo revisar el diff actual (ya has codeado tu)
kj review

# Solo generar plan de implementacion
kj plan "Migrar de REST a GraphQL"

# Con tarea del Planning Game
kj run --task PLN-TSK-0155

# Ver reportes
kj report                    # Ultimo reporte
kj report --list             # Lista de reportes

# Verificar entorno
kj doctor

# Gestion SonarQube
kj sonar status              # Estado del contenedor
kj sonar stop                # Parar
kj sonar start               # Arrancar
kj sonar open                # Abrir en navegador

# Ver/editar config
kj config
kj config --edit
```

### Ejemplo kj.config.yml

```yaml
# AI Agents
coder: claude                    # claude | codex | gemini | aider
reviewer: gemini                 # claude | codex | gemini | aider

# Review settings
review_mode: strict              # paranoid | strict | standard | relaxed | custom
max_iterations: 5                # Maximo de ciclos coder/reviewer
review_rules: ./review-rules.md  # Reglas custom para el reviewer

# Coder settings
coder_options:
  allowed_tools: "Read,Edit,Bash"  # Solo aplica a claude/codex
  model: null                      # null = default del CLI
  auto_approve: true               # Auto-aprobar acciones del coder

# Reviewer settings
reviewer_options:
  output_format: json              # json para parsing automatico
  model: null

# SonarQube settings
sonarqube:
  enabled: true                        # true = SonarQube en el loop, false = saltar
  host: http://localhost:9000
  token: null                          # Auto-generado por kj init
  quality_gate: true                   # Fallar si no pasa el Quality Gate
  fail_on:                             # Severidades que bloquean el loop
    - BLOCKER
    - CRITICAL
  ignore_on:                           # Severidades que se ignoran
    - INFO
  max_scan_retries: 3                  # Intentos del coder para corregir issues de SonarQube

# Git (post-aprobacion)
git:
  auto_commit: true
  auto_push: false               # Requiere confirmacion
  auto_pr: false                 # Requiere confirmacion
  branch_prefix: "feat/"

# Planning Game MCP (opcional)
planning_game:
  enabled: false
  project_id: null

# Output
output:
  report_dir: ./reviews          # Donde guardar reportes
  log_level: info                # debug | info | warn | error
```

---

## Fuentes

- [Claude Code - Modo headless / Agent SDK](https://code.claude.com/docs/en/headless)
- [Codex CLI - Non-interactive mode](https://developers.openai.com/codex/noninteractive/)
- [Codex SDK (TypeScript)](https://developers.openai.com/codex/sdk/)
- [Gemini CLI - Headless mode](https://geminicli.com/docs/cli/headless/)
- [Gemini CLI - GitHub](https://github.com/google-gemini/gemini-cli)
- [Aider - Scripting](https://aider.chat/docs/scripting.html)
- [SonarQube Docker setup](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/scanners/sonarscanner/)
- [sonar-scanner-cli Docker image](https://hub.docker.com/r/sonarsource/sonar-scanner-cli)
- [2026 Guide to Coding CLI Tools - Tembo](https://www.tembo.io/blog/coding-cli-tools-comparison)
- [Top 5 Agentic Coding CLI Tools - KDnuggets](https://www.kdnuggets.com/top-5-agentic-coding-cli-tools)
