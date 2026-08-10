# Primeros pasos con Karajan Code

## Requisitos previos

- Node.js ≥ 22.22 (Karajan v3.0.0 elimina soporte de Node 20 — ver CHANGELOG para notas de migración)
- Git
- Al menos una CLI de IA instalada: `claude`, `codex`, `gemini`, `aider` u `opencode`
- (Opcional) Docker para SonarQube local
- RTK + Squeezr (eficiencia de tokens) — `kj init` los instala automáticamente. Para no usarlos, `--no-rtk` / `--no-squeezr`.
- QMD (wiki semántica por proyecto) — `kj init` registra `docs/`, `.reviews/` y `.karajan/plans/` como colecciones indexadas, y `kj qmd query "..."` consulta contra el proyecto activo. El índice RAG sirve al **agente**; QMD te sirve a **ti**. Para no usarlo, `--no-qmd`.

### Scanners opcionales — `kj audit` + `kj webperf`

El pipeline de audit de Karajan corre scanners deterministas en paralelo y mete sus hallazgos en el prompt del LLM. **Ninguno es obligatorio** — Karajan se salta los que no estén instalados, con un hint amigable. Instala los que correspondan al tipo de proyecto que auditas.

| Tool | Instalación | Usado por | Te da |
|------|-------------|-----------|-------|
| **SonarQube** | `docker compose -f ~/sonarqube/docker-compose.yml up -d` | `kj audit`, `kj run` | Code quality + security rules con line-precision; `kj audit` cruza los hallazgos del LLM con los rule IDs de Sonar |
| **OSV-Scanner** | `go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest` | `kj audit` | Cobertura CVE de dependencias más amplia que `npm audit` (GitHub Advisory DB + GLSA + Go vuln DB + otros). Sin cuenta, sin upload |
| **Semgrep** | `pipx install semgrep` (o `brew install semgrep`) | `kj audit` | SAST: XSS, SQLi, taint flow, secrets hardcodeados, anti-patrones específicos por lenguaje. Equivalente a `snyk code` pero gratis para OSS. `--config auto` trae 2 000+ reglas |
| **Lighthouse** | `npm install -g lighthouse` | `kj webperf`, `kj audit` (cuando hay scan) | Core Web Vitals (LCP, CLS, INP) + audits de oportunidades (render-blocking, CSS sin uso, formato de imagen, font-display) para proyectos frontend. `kj webperf` escribe el resultado en `~/.karajan/webperf/<slug>/last.json` y `kj audit` lo lee automáticamente |

Saltar cualquiera por ejecución con el flag `--no-*` correspondiente (`--no-sonar`, `--no-osv`, `--no-semgrep`).

### Instalación en un comando con `kj install-tools` (v2.18+)

No hace falta copiar los comandos de arriba a mano. Después de `npm install -g karajan-code`:

```bash
kj doctor                 # Muestra qué falta y el comando de instalación para TU sistema
kj install-tools          # Interactivo — instala cada herramienta usando el gestor de paquetes que ya tienes
kj install-tools --yes    # No interactivo (CI / automatización)
kj install-tools --dry-run                       # Solo planifica, imprime qué haría
kj install-tools --only semgrep,osv-scanner      # Subset
```

Comportamiento por herramienta:

- **Semgrep**: usa `pipx install semgrep` si pipx está disponible, cae a `brew install semgrep`, luego `pip install semgrep`.
- **OSV-Scanner**: usa `go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest` si Go está disponible, cae a `brew install osv-scanner`.
- **Lighthouse**: `npm install -g lighthouse`. **Solo se sugiere en proyectos frontend / fullstack** — proyectos backend-only no ven ruido de lighthouse. Usa `--only lighthouse` para forzar.
- **Docker**: nunca se auto-instala (depende de plataforma). Imprime URL de docs y, en macOS, el hint `brew install --cask docker`.
- **Sonar**: necesita Docker. Si hay un `docker-compose.yml` en el cwd, sugiere `docker compose up -d`; si no, un `docker run` puntual con la imagen oficial de SonarQube.

`kj doctor` lista cada herramienta faltante con el comando de install elegido para tu sistema y termina con un recordatorio `Tip: run kj install-tools …`, así que el flujo típico es:

```bash
kj doctor              # ver qué falta
kj install-tools       # arreglarlo
kj doctor              # confirmar limpio
```

## Instalación

```bash
npm install -g karajan-code
```

Verifica:
```bash
kj --version    # 4.16.0
kj doctor       # Comprobar entorno
```

## Primera ejecución

### Opción A: Zero config (lo más simple)

```bash
mkdir mi-proyecto && cd mi-proyecto
kj run "Construye una API REST para una lista de tareas con Express y tests Vitest"
```

Karajan auto-inicializa:
1. Crea repo git + `.gitignore`
2. Crea `.karajan/` con plantillas de roles
3. Asigna automáticamente agentes de IA a roles según capacidad
4. Ejecuta pipeline: **spec-reviewer** → triage → (auto-descomposición en HUs si es compleja) → coder → reviewer → tester → security → audit

El **spec-reviewer** corre primero y audita tu tarea en busca de deficiencias (ambigüedades, falta de scope, falta de criterios de aceptación, …). Si la spec es limpia imprime una sola línea `✓ spec OK` y sigue en silencio. Si hay findings muestra un bloque coloreado en stderr y pregunta `[c]ontinue / [r]efine / [x]cancel?` — pulsa `r` para que el rol reescriba la spec en una v2 que puedes editar antes de que arranque el pipeline. Bypass con `--skip-spec-review`. Referencia completa: [../spec-reviewer.md](../spec-reviewer.md).

Si triage detecta que la tarea es compleja, Karajan la descompone automáticamente en HUs atómicas (Historias de Usuario). Cada HU se ejecuta como sub-pipeline independiente con su propia rama, commit y PR. Cada HU también lleva tests de aceptación ejecutables que Brain lanza tras cada iteración del coder — todos pasan → aprobada, alguno falla → Brain diagnostica con el error exacto.

Al terminar, revisa `.reviews/session_*/summary.md`.

### Opción B: Setup interactivo

```bash
kj init
```

El wizard pregunta:
- Qué agentes de IA usar (detectados automáticamente)
- SonarQube sí/no
- Enforcement TDD
- HU Board sí/no
- Idioma (en/es)

Escribe `~/.karajan/kj.config.yml`. Sobrescríbelo por proyecto con `.karajan/kj.config.yml`.

## Comandos habituales

```bash
kj run "tarea"                # Pipeline completo
kj run "tarea" --enable-brain # Con Karajan Brain (v2)
kj code "tarea"               # Solo coder, sin review
kj plan "tarea"               # Generar plan + HUs (v2.5)
kj review                     # Review de cambios no commiteados
kj audit                      # Auditar toda la base de código
kj status                     # Estado de la sesión actual
kj resume <session-id>        # Reanudar sesión pausada
kj doctor                     # Comprobar entorno
kj harden                     # Instalar el harness de calidad (hooks, config, CI, guías)
kj check                      # Verificar que el harness está presente e íntegro

# Gestión de planes (v2.5+)
kj plan list                  # Listar planes del proyecto actual
kj plan show <planId>         # Ver detalles del plan + tabla de HUs
kj plan validate <planId>     # Verificar estructura, deps, IDs
kj plan ready <planId>        # Certificar todas las HUs, marcar listo para ejecutar
kj plan add-hu <planId>       # Añadir HU (--title, --type, --deps, --scope)
kj plan remove-hu <planId> <huId>  # Eliminar HU del plan
kj plan delete <planId>       # Borrar plan del disco
kj run --plan <planId> "tarea"     # Ejecutar un plan aprobado

# Dashboard HU Board
kj board start                # Iniciar dashboard web (puerto 4000, fallback 4001-4009)
kj board open                 # Iniciar + abrir en el navegador
kj board status               # Comprobar si está corriendo
kj board stop                 # Detener el board
```

## Harness de calidad — `kj harden` + `kj check`

`kj harden` lleva los guardrails con los que se construyó Karajan a **cualquier**
repositorio —nuevo o existente— en un solo comando. Es idempotente, consciente
del stack y nunca sobrescribe lo que tú escribiste: todo lo que gestiona vive
entre marcadores `kj:managed`, así que al reejecutarlo solo refresca sus propios
bloques.

```bash
kj harden                       # Instala el perfil standard
kj harden --profile strict      # Añade además el gate de shrink-budget
kj harden --dry-run             # Muestra qué cambiaría, sin escribir
kj harden --no-ci --no-guidelines   # Solo hooks + config
```

Qué instala (según el stack detectado):

- **Hooks de git** bajo `.karajan/hooks/` (vía `core.hooksPath`, sin pelear con
  husky): pre-commit lint+formato, commit-msg (Conventional Commits + tope de
  100 caracteres + bloqueo de atribución a IA — POSIX puro, sin Node), pre-push
  tests + guardia de identidad, post-merge reindex. **Comandos nativos por
  lenguaje** (`go vet`/`ruff`/`npm`…), de modo que endurecer un repo Go o Python
  nunca convierte a Node en dependencia de commit.
- **Config**: `.editorconfig`, `commitlint.config.js` y lint/formato por lenguaje
  (`eslint` con la lista negra de APIs ES2025 obsoletas + `prettier` en JS/TS,
  `ruff.toml` en Python, `.golangci.yml` en Go). En un monorepo fullstack cada
  lenguaje recibe su config dentro de su propia carpeta.
- **Workflows de CI**: gate de atribución a IA, workflow Quality por stack y
  (en `strict`/paquetes publicables) shrink-budget + pack-smoke.
- **Guías para agentes**: un conjunto de reglas destilado, sembrado en
  `AGENTS.md` y `CLAUDE.md` (migrando limpiamente cualquier bloque heredado).

`kj init` ejecuta el mismo motor automáticamente, así que un proyecto recién
inicializado queda endurecido de serie (desactívalo con `kj init --no-harden`).

```bash
kj check            # Exit 0 si el harness está íntegro; ≠0 + reporte si hay deriva
kj check --json     # Salida procesable, para CI
```

`kj check` detecta deriva —un hook borrado, un marker eliminado, o un lenguaje
que añadiste después de endurecer y cuya config nunca se sembró— y te dice que
reejecutes `kj harden`.

## Flujo de planificación (v2.5+)

`kj plan` introduce un flujo en dos fases: **planificar → revisar → ejecutar**. En lugar de codificar inmediatamente, primero se genera un plan estructurado con HUs, se inspecciona y ajusta, y se ejecuta cuando está listo.

```bash
# Fase 1: generar un plan con HUs y tests de aceptación
kj plan "Refactorizar la capa de autenticación para usar JWT"
# → escribe el plan en disco, imprime planId (p.ej. plan_1234)

# Inspeccionar y ajustar
kj plan show plan_1234        # Revisar tabla de HUs, deps, criterios de aceptación
kj plan validate plan_1234    # Verificar estructura, sin deps rotas
kj plan add-hu plan_1234 --title "Añadir endpoint de refresh token" --type feat
kj plan remove-hu plan_1234 hu_03

# Fase 2: certificar y ejecutar
kj plan ready plan_1234       # Certifica todas las HUs, marca el plan como listo
kj run --plan plan_1234 "Refactorizar la capa de autenticación para usar JWT"
# → omite las etapas researcher/architect/planner, carga el plan directamente
```

El plan se guarda en `.karajan/plans/` y persiste entre sesiones. Usa `kj plan list` para ver todos los planes del proyecto actual.

## Configuración

`.karajan/kj.config.yml` mínimo:

```yaml
coder: claude
reviewer: codex
max_iterations: 5
max_budget_usd: 5

pipeline:
  planner: { enabled: true }
  researcher: { enabled: true }
  tester: { enabled: true }
  security: { enabled: true }
  brain: { enabled: true }    # v2 — Karajan Brain

sonarqube:
  enabled: true               # Arranca Docker automáticamente si está disponible

git:
  auto_commit: true
  auto_push: false
  auto_pr: false
```

Referencia completa: [configuration.md](../configuration.md).

## Karajan Brain (feature v2)

Habilita el orquestador IA central:

```yaml
brain:
  enabled: true
  provider: claude            # IA preferida para decisiones del Brain
```

Cuando está activado, Brain:
- Enruta la comunicación entre roles con inteligencia
- Enriquece feedback vago con rutas de ficheros y planes de acción concretos
- Comprime outputs entre roles (40-70% de ahorro de tokens)
- Verifica que el coder produjo cambios reales (no iteraciones 0-ficheros)
- Ejecuta acciones directas (npm install, actualizaciones de .gitignore)
- Consulta a Solomon (juez IA) solo en dilemas genuinos

## Dónde guarda Karajan sus datos

Todo lo que Karajan persiste entre ejecuciones vive ahora bajo una única raíz: **`~/.karajan/`**. (Hasta v2.18.x los planes y el estado de hibernación vivían bajo `~/.kj/`. A partir de v2.19 el layout queda unificado; el legacy `~/.kj/` se migra automáticamente en el siguiente comando `kj`, con backup tarball en `~/.karajan/backup/`.)

| Ruta | Qué contiene |
|------|--------------|
| `~/.karajan/plans/<slug>/` | Outputs de `kj plan` persistidos (un subdir por proyecto) |
| `~/.karajan/sessions/<id>/` | Sesiones de runs CLI activas y completadas |
| `~/.karajan/hu-stories/<id>/` | Batches de HUs generados por la auto-descomposición |
| `~/.karajan/standby/<id>.json` | Runs hibernados (recovery de cuota / rate-limit) |
| `~/.karajan/runs/<id>.json` | Registro de runs activos (sincroniza CLI ↔ HU Board) |
| `~/.karajan/worktrees/` | Worktrees git aislados |
| `~/.karajan/kj.config.yml` | Config global (sobrescrita por proyecto en `<proyecto>/.karajan/kj.config.yml`) |
| `~/.karajan/backup/` | Tarballs creados por el auto-migrator (puedes borrarlos cuando confirmes que no falta nada) |
| `<proyecto>/.kj/run.log` | Log de run en tiempo real que sigue `kj-tail` |
| `<proyecto>/.reviews/session_<id>/` | Journal por sesión (triage.md, plan.md, iterations.md, summary.md, …) |

Para sobrescribir la raíz exporta `KARAJAN_HOME=/ruta`. La variable legacy `KJ_HOME` sigue respetada pero imprime un warning de deprecación.

> **Footprint & HW**: el peso típico de `~/.karajan/` es ~40 MB tras varias semanas de uso. Para la tabla completa de tamaños (tarball npm, imágenes Docker, modelos de Ollama, caché de qmd) y los requisitos de hardware por perfil de instalación, consulta la sección [Footprint & hardware requirements en el README](../../README.md#footprint--hardware-requirements).

## Visualización del pipeline

Consulta [ARCHITECTURE.md](../ARCHITECTURE.md) para el diagrama completo de arquitectura y la documentación de componentes.

## Troubleshooting

Problemas comunes: [troubleshooting.md](../troubleshooting.md)

## Siguientes pasos

- Lee [ARCHITECTURE.md](../ARCHITECTURE.md) para entender el pipeline
- Usa las [plantillas de task file](../task-templates/README.md) cuando ejecutes `kj plan generate`, `kj run`, `kj researcher`, `kj architect`, `kj discover` o `kj refactorer` — codifican el sweet spot entre demasiado-breve y demasiado-pre-procesado
- Revisa [SKILLS.md](../SKILLS.md) para la integración con OpenSkills
- Navega [templates/roles/](../../templates/roles/) para ver las definiciones de roles
- Si migras desde v1: [MIGRATION-v2.md](../../MIGRATION-v2.md)
