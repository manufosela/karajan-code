---
title: Comandos CLI
description: Referencia completa de todos los comandos y flags de kj.
---

## Resumen de Comandos

| Comando | Descripción |
|---------|-------------|
| `kj init` | Wizard interactivo de configuración |
| `kj run <task>` | Pipeline completo: coder → sonar → reviewer |
| `kj code <task>` | Solo coder |
| `kj review <task>` | Solo reviewer |
| `kj plan <task>` | Generar plan de implementación |
| `kj scan` | Ejecutar análisis SonarQube |
| `kj doctor` | Verificar entorno |
| `kj config` | Mostrar configuración |
| `kj report` | Informes de sesión con tracking de presupuesto |
| `kj resume <id>` | Reanudar sesión pausada |
| `kj roles` | Inspeccionar roles y templates del pipeline |
| `kj agents` | Listar o cambiar el agente IA por rol del pipeline |
| `kj audit [task]` | Auditoría de salud del codebase de solo lectura (5 dimensiones, puntuaciones A-F) |
| `kj status` | Dashboard de terminal con estados de HUs, stage, tiempos, progreso |
| `kj undo` | Revertir ultima ejecucion del pipeline (soft reset o --hard) |
| `kj board <subcommand>` | Gestionar dashboard HU Board |
| `kj sonar <subcommand>` | Gestionar contenedor Docker de SonarQube |

**Opciones globales:** `--help`, `--version`

---

## kj init

Inicializar configuración, reglas de revisión y setup de SonarQube.

```bash
kj init [options]
```

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--no-interactive` | boolean | `false` | Saltar wizard, usar defaults (para CI/scripts) |

**Que hace:**
- Crea `~/.karajan/kj.config.yml` con defaults sensatos
- Crea `review-rules.md` y `coder-rules.md` en el proyecto
- Detecta agentes IA disponibles y guia la seleccion
- Arranca contenedor Docker de SonarQube si esta habilitado
- Auto-añade `.kj/`, `.agent/`, `.scannerwork/` al `.gitignore` del proyecto si faltan (v1.57.2+)

**Ejemplos:**

```bash
# Setup interactivo
kj init

# No interactivo (CI/CD)
kj init --no-interactive
```

---

## kj run

Pipeline completo: coder → refactorer → sonar → bucle reviewer con etapas opcionales pre/post.

```bash
kj run "<task>" [options]
```

### Argumento task

El argumento `<task>` acepta:
- Una descripción en texto: `"Corregir el bug de login"`
- Un ID de card del Planning Game: `"KJC-TSK-0042"` (cuando `--pg-project` está configurado o el config tiene `planning_game.project_id`)

### Opciones de agente

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--coder <name>` | string | de config | Agente IA para codificar (claude, codex, gemini, aider, opencode) |
| `--reviewer <name>` | string | de config | Agente IA para revisión |
| `--planner <name>` | string | — | Agente IA para planificación |
| `--refactorer <name>` | string | — | Agente IA para refactoring |
| `--coder-model <model>` | string | — | Modelo específico para coder (ej: sonnet, opus) |
| `--reviewer-model <model>` | string | — | Modelo específico para reviewer |
| `--planner-model <model>` | string | — | Modelo específico para planner |
| `--refactorer-model <model>` | string | — | Modelo específico para refactorer |

### Toggles de etapas del pipeline

| Flag | Default | Descripción |
|------|---------|-------------|
| `--enable-planner` | off | Habilitar etapa de planificación |
| `--enable-refactorer` | off | Habilitar etapa de refactoring |
| `--enable-researcher` | off | Habilitar etapa de investigación (análisis del codebase) |
| `--enable-tester` | off | Habilitar etapa de testing (quality gate de tests) |
| `--enable-security` | off | Habilitar auditoría de seguridad (OWASP) |
| `--enable-triage` | off | Habilitar clasificación de complejidad |
| `--enable-reviewer` | on | Habilitar etapa de revisión |
| `--enable-serena` | off | Habilitar integración Serena MCP |
| `--enable-impeccable` | off | Habilitar auditoría de diseño Impeccable (quality gate automatizado de UI/UX) |
| `--enable-hu-reviewer` | off | Habilitar certificación de HUs (quality gate de historias de usuario) |
| `--hu-file <path>` | string | Ruta al fichero de historia de usuario para el HU reviewer |
| `--auto-simplify` | on | Auto-simplificar pipeline para triage nivel 1-2 (solo coder, omite reviewer/tester) |
| `--no-auto-simplify` | — | Desactivar auto-simplify: ejecutar siempre el pipeline completo independientemente del nivel de triage |

### Revisión y metodología

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--mode <name>` | string | `standard` | Exigencia de revisión: `paranoid`, `strict`, `standard`, `relaxed` |
| `--methodology <name>` | string | auto-detectado | Enfoque de desarrollo: `tdd` o `standard`. Auto-detectado del framework de tests del proyecto desde v1.25.0 |
| `--reviewer-fallback <name>` | string | `codex` | Reviewer de respaldo si el primario falla |
| `--reviewer-retries <n>` | number | `1` | Máximo de reintentos del reviewer |
| `--coder-fallback <name>` | string | — | Coder de respaldo si el primario alcanza rate limit |

### Límites de sesión

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--max-iterations <n>` | number | `5` | Máximo de bucles coder/reviewer |
| `--max-iteration-minutes <n>` | number | `15` | Timeout por iteración (minutos) |
| `--max-total-minutes <n>` | number | `120` | Timeout total de sesión (minutos) |
| `--checkpoint-interval <n>` | number | `5` | Minutos entre checkpoints interactivos (0 para desactivar) |

### Opciones de Git

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--base-branch <name>` | string | `main` | Rama base para generar diff |
| `--base-ref <ref>` | string | — | Ref git explícita (ej: HEAD~3) |
| `--auto-commit` | boolean | `false` | Auto-commit tras aprobación |
| `--auto-push` | boolean | `false` | Auto-push tras commit |
| `--auto-pr` | boolean | `false` | Crear PR tras push |
| `--no-auto-rebase` | boolean | `false` | Desactivar auto-rebase antes de push |
| `--branch-prefix <prefix>` | string | `feat/` | Prefijo de nombre de rama |

### SonarQube e integraciones

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--no-sonar` | boolean | `false` | Saltar análisis SonarQube |
| `--pg-task <cardId>` | string | — | ID de card del Planning Game |
| `--pg-project <projectId>` | string | — | ID de proyecto del Planning Game |
| `--smart-models` | boolean | de config | Activar selección inteligente de modelos según complejidad del triage |
| `--no-smart-models` | boolean | — | Desactivar selección inteligente de modelos |

### Output

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--dry-run` | boolean | `false` | Mostrar qué se ejecutaría sin ejecutar |
| `--json` | boolean | `false` | Output solo JSON (sin display estilizado) |

### Ejemplos

```bash
# Ejecución básica con defaults
kj run "Añadir validación de inputs al formulario de registro"

# TDD estricto con agentes específicos
kj run "Corregir inyección SQL en endpoint de búsqueda" \
  --coder claude --reviewer codex --mode paranoid

# Multi-agente con todas las etapas
kj run "Implementar autenticación de usuario" \
  --enable-planner --enable-tester --enable-security \
  --coder claude --reviewer codex --max-iterations 3

# Integración Planning Game
kj run "KJC-TSK-0042" --pg-project "Karajan Code"

# Dry run para previsualizar pipeline
kj run "Refactorizar capa de base de datos" --dry-run

# Auto-commit y push tras aprobación
kj run "Añadir spinner de carga" --auto-commit --auto-push
```

---

## kj code

Ejecutar solo coder — sin bucle de revisión. Útil para cambios rápidos que revisarás tú mismo.

```bash
kj code "<task>" [options]
```

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--coder <name>` | string | de config | Agente IA para codificar |
| `--coder-model <model>` | string | — | Modelo específico para coder |

**Ejemplos:**

```bash
kj code "Añadir un spinner de carga al dashboard"
kj code "Escribir tests unitarios para el servicio de auth" --coder gemini
```

---

## kj review

Ejecutar solo reviewer contra el diff git actual. Útil después de cambios manuales.

```bash
kj review "<task>" [options]
```

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--reviewer <name>` | string | de config | Agente IA para revisión |
| `--reviewer-model <model>` | string | — | Modelo específico para reviewer |
| `--base-ref <ref>` | string | `main` | Ref git contra la que hacer diff |

**Ejemplos:**

```bash
kj review "Revisar mi refactor de autenticación"
kj review "Buscar problemas de seguridad" --reviewer claude --base-ref HEAD~5
```

### Probar la review cruzada en CI (`--publish-pr`, `--verify-pr`)

`kj review --publish-pr <n>` publica, como una sola review de GitHub, el veredicto que kj guarda de cada commit de la PR, atado al hash del diff que trajo. `kj review --verify-pr <n>` es su parte de CI: sale con 1 y nombra cada commit que la review del head actual de la PR no lista con un hash de diff que coincida. Solo cuenta una review escrita por un owner, member o collaborator del repo, así que saltarse el hook de pre-commit (`--no-verify`) ya no deja un commit sin revisar.

### Revisar la PR de otra persona (`--third-party`)

Para agentes revisores y para quien revisa PRs ajenas. En un clon con el head de la PR:

```bash
kj review --range main...rama-de-la-pr --third-party --json --reviewer claude
```

- Corre solo el reviewer de kj, con las reglas del repo destino (`.karajan`) y el proveedor que indiques, aunque sea en el que estás trabajando.
- Se salta las gates del trabajo propio (card, tests junto al código, policy, prueba de RAG de la sesión) y **no guarda veredicto**: nunca puede desbloquear un commit tuyo. `kj review --range` sin `--third-party` mantiene todas las gates.
- Añade checks sin tokens, en dos listas. `checks` lleva la seguridad: `secrets`, `privacy`, `prompt-injection`, `dependency-cooldown`, `semgrep` (solo los ficheros de la PR) y `sonar` (si hay SonarQube accesible; si no, "not available"). `policyChecks` lleva los requisitos de la casa, que otro repo puede no compartir: `size` (el presupuesto del repo), `conventional-commits`, `ai-attribution` y `tests`.
- `--lens qa` revisa con una rúbrica de QA: comportamiento nuevo sin test, tests que no pueden fallar, inestabilidad de serie (esperas fijas, orden, reloj o red sin controlar), selectores frágiles, escenarios que faltan y datos de prueba que no son reservados para pruebas.
- Los falsos positivos de privacidad conocidos del repo revisado van en su propio `.karajan/privacy.yml`, bajo `allow`. Se lee en la **base** del rango, así que una PR no puede añadirse la exención que necesita; una lista `personal` en ese fichero se ignora (solo vive en `~/.karajan/privacy.yml`).
- Datos de prueba con teléfonos o correos de aspecto normal: declara las carpetas de test en `test_paths`, en el mismo fichero (por ejemplo `src/test/**`, `**/testdata/**`). En esos ficheros los hallazgos genéricos de datos personales se descartan y se cuentan en el detalle del check; la denylist personal y las formas de secreto siguen bloqueando. Un glob sin nombre de carpeta (`**`, `**/*`) se rechaza.
- Revisa el diff entero de una PR grande: agrupa ficheros completos en lotes que caben en un prompt del revisor, hasta 10 llamadas. Un fichero demasiado grande para un prompt se parte por hunks, y un hunk demasiado grande (un fichero nuevo es un solo hunk) por líneas, cada trozo con la cabecera del fichero y sus propios números de línea; solo los ficheros que pasan del tope, o una sola línea que por sí sola no cabe, se quedan sin revisar, y salen en `coverage.unreviewed`. `verdict.status` es `rejected` si algún lote lo fue, `approved` solo si se revisaron todos los ficheros, y `partial` en otro caso (`approved: false`).
- Por encima del presupuesto de tamaño (el del repo, 200 líneas por defecto; los ficheros generados y los lockfiles no cuentan), añade `advice.split`: por qué una PR tan grande se revisa peor, y una propuesta de trozos, cada uno con nombre, propósito, ficheros y líneas aproximadas. Los trozos siguen la estructura del proyecto (el paquete Java/Kotlin bajo el paquete raíz, la carpeta bajo `src/` en JS/TS, tests y recursos aparte) y van ordenados por capa (configuración, tipos de datos, utilidades, servicios, páginas, flujos, tests) para que cada uno se apoye en los anteriores. Es un consejo: nunca cuenta como hallazgo ni cambia el veredicto.
- Imprime un único documento JSON en stdout (los logs van a stderr) y sale con código 0 sea cual sea el veredicto; un código distinto de 0 significa que ha fallado kj.

```json
{
  "mode": "third-party",
  "range": "main...rama-de-la-pr",
  "reviewer": "claude",
  "verdict": { "status": "rejected", "approved": false, "summary": "..." },
  "coverage": { "files": { "reviewed": 52, "total": 52 }, "lines": { "reviewed": 1822, "total": 1822 }, "truncated": false, "unreviewed": [] },
  "findings": [{ "file": "src/add.js", "line": 2, "severity": "high", "description": "...", "suggested_fix": "..." }],
  "suggestions": ["..."],
  "checks": [{ "id": "secrets", "ok": true, "detail": "..." }],
  "policyChecks": [{ "id": "tests", "ok": false, "detail": "source changed with no test changed" }]
}
```

---

## kj plan

Generar un plan de implementación sin escribir código.

```bash
kj plan "<task>" [options]
```

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--planner <name>` | string | rol coder | Agente IA para planificación |
| `--planner-model <model>` | string | — | Modelo específico para planner |
| `--context <text>` | string | — | Contexto adicional para el planner |
| `--json` | boolean | `false` | Output JSON crudo del plan |

**Ejemplos:**

```bash
kj plan "Migrar de REST a GraphQL"
kj plan "Añadir soporte multi-tenant" --context "Usando row-level security" --json
```

---

## kj scan

Ejecutar análisis estático SonarQube sobre el proyecto actual.

```bash
kj scan
```

Sin opciones adicionales. Usa la configuración de SonarQube del config.

**Prerrequisitos:** Docker corriendo, contenedor SonarQube arrancado (`kj sonar start`).

---

## kj doctor

Verificar el entorno del sistema para herramientas y configuración requeridas.

```bash
kj doctor
```

**Comprobaciones realizadas:**

| Check | Qué verifica |
|-------|-------------|
| Karajan version | Muestra la versión instalada de Karajan Code |
| Config file | `kj.config.yml` existe |
| Git repository | Dentro de un repo git |
| Docker | Docker instalado |
| SonarQube | Accesible en el host configurado |
| Agent CLIs | Claude, Codex, Gemini, Aider responden a `--version` |
| Core binaries | node, npm, git instalados |
| Serena MCP | `serena --version` (cuando habilitado) |
| Rule files | review-rules.md y coder-rules.md existen |

Cada check muestra `OK` o `MISS` con una solución sugerida.

---

## kj config

Mostrar o editar la configuración.

```bash
kj config [options]
```

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--json` | boolean | `false` | Output como JSON |
| `--edit` | boolean | `false` | Abrir en `$EDITOR` para editar |

**Ejemplos:**

```bash
kj config              # Pretty-print del config actual
kj config --json       # Output como JSON
kj config --edit       # Abrir en editor
```

---

## kj report

Mostrar informes de sesión con tracking de presupuesto y uso de tokens.

```bash
kj report [options]
```

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--list` | boolean | `false` | Listar todos los IDs de sesión |
| `--session-id <id>` | string | última | Mostrar informe de una sesión específica |
| `--format <type>` | string | `text` | Formato de output: `text` o `json` |
| `--trace` | boolean | `false` | Mostrar traza cronológica de todas las etapas |
| `--currency <code>` | string | `usd` | Mostrar costes en `usd` o `eur` |

**El informe incluye:**
- ID de sesión y estado
- Descripción de la tarea
- Etapas del pipeline ejecutadas
- Iteraciones (ejecuciones del coder, intentos del reviewer, estado de aprobación)
- Issues de SonarQube (inicial → final → delta)
- Presupuesto estimado consumido
- Commits generados
- Modo trace: timing por etapa, tokens in/out, desglose de costes

**Ejemplos:**

```bash
kj report                              # Última sesión
kj report --trace                      # Desglose detallado de costes
kj report --list                       # Listar todas las sesiones
kj report --session-id s_2026-02-28... # Sesión específica
kj report --trace --currency eur       # Costes en EUR
kj report --format json                # Legible por máquina
```

---

## kj resume

Reanudar una sesión pausada, detenida o fallida. Las sesiones se pausan por detección de repeticiones, avisos de presupuesto o cuando se necesita guía humana.

```bash
kj resume <sessionId> [options]
```

| Flag | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `--answer <text>` | string | — | Respuesta a la pregunta que causó la pausa |
| `--json` | boolean | `false` | Output solo JSON |

**Ejemplos:**

```bash
# Reanudar con guía
kj resume s_2026-02-28T20-47-24 --answer "Enfócate en el issue de seguridad primero"

# Reanudar y ver resultado como JSON
kj resume s_2026-02-28T20-47-24 --answer "Ignora los issues de estilo" --json
```

---

## kj roles

Listar roles del pipeline o mostrar instrucciones del template de un rol.

```bash
kj roles [subcommand] [role]
```

| Subcomando | Descripción |
|------------|-------------|
| `list` (default) | Listar todos los roles disponibles |
| `show <role>` | Mostrar el template completo de un rol |

**Roles disponibles:**

| Rol | Propósito |
|-----|-----------|
| `triage` | Clasificación de complejidad de tareas |
| `researcher` | Investigación del codebase |
| `planner` | Planificación de implementación |
| `coder` | Generación de código y tests |
| `refactorer` | Mejora de calidad de código |
| `sonar` | Análisis estático |
| `reviewer` | Revisión de código |
| `tester` | Quality gate de tests |
| `security` | Auditoría de seguridad OWASP |
| `solomon` | Resolución de conflictos |
| `commiter` | Automatización git |
| `discover` | Detección de gaps pre-ejecución |
| `hu-reviewer` | Certificación de historias de usuario |
| `architect` | Diseño de arquitectura de solución |
| `audit` | Auditoría de salud del codebase de solo lectura |

Variantes de modo de revisión: `reviewer-strict`, `reviewer-relaxed`, `reviewer-paranoid`

**Ejemplos:**

```bash
kj roles                    # Listar todos los roles
kj roles show coder         # Mostrar template del coder
kj roles show reviewer      # Mostrar template del reviewer
```

---

## kj agents

Listar o cambiar el agente IA asignado a cada rol del pipeline al vuelo. Los cambios se persisten en `kj.config.yml` — no requiere reinicio.

```bash
kj agents [subcommand] [role] [agent]
```

| Subcomando | Descripción |
|------------|-------------|
| `list` (default) | Mostrar asignación actual de agente por rol |
| `set <role> <agent>` | Asignar un agente a un rol y persistir en config |

**Ejemplos:**

```bash
kj agents                    # Listar agente actual por rol
kj agents list               # Igual que arriba
kj agents set coder gemini   # Cambiar el rol coder a Gemini
kj agents set reviewer claude # Cambiar el rol reviewer a Claude
```

---

## kj status

Muestra un dashboard de terminal con los estados de las HUs, la stage actual del pipeline, tiempos y progreso general.

```bash
kj status
```

Cuando se llama via MCP (`kj_status`), devuelve JSON estructurado con la misma informacion para acceso programatico.

**El output incluye:**
- Stage actual del pipeline y agente
- Estados de las HUs (pending, coding, reviewing, done, failed, blocked)
- Cuenta de iteraciones y tiempos
- Porcentaje de progreso
- Resumen de errores (si los hay)

---

## kj undo

Revierte la ultima ejecucion del pipeline. Realiza un soft reset de git por defecto, preservando los cambios en el directorio de trabajo.

```bash
kj undo [options]
```

| Flag | Tipo | Default | Descripcion |
|------|------|---------|-------------|
| `--hard` | boolean | `false` | Hard reset: descarta todos los cambios de la ultima ejecucion |
| `--session-id <id>` | string | ultima | Revertir una sesion especifica en vez de la ultima |

**Ejemplos:**

```bash
# Soft reset (mantiene cambios en directorio de trabajo)
kj undo

# Hard reset (descarta todos los cambios)
kj undo --hard

# Revertir una sesion especifica
kj undo --session-id s_2026-03-28T14-30-00
```

---

## kj board

Gestionar el dashboard HU Board para seguimiento visual de tareas.

```bash
kj board <subcommand>
```

| Subcomando | Descripción |
|------------|-------------|
| `start` | Arrancar el dashboard HU Board |
| `stop` | Parar el dashboard HU Board |
| `status` | Comprobar si el HU Board está corriendo |
| `open` | Abrir el HU Board en el navegador |

**Ejemplos:**

```bash
kj board start      # Arrancar el dashboard
kj board status     # Comprobar si está corriendo
kj board open       # Abrir en el navegador
kj board stop       # Parar el dashboard
```

---

## kj sonar

Gestionar el contenedor Docker de SonarQube.

```bash
kj sonar <subcommand>
```

| Subcomando | Descripción |
|------------|-------------|
| `status` | Comprobar estado del contenedor |
| `start` | Arrancar contenedor SonarQube |
| `stop` | Parar contenedor SonarQube |
| `logs` | Ver logs del contenedor |
| `open` | Abrir dashboard SonarQube en el navegador |

**Ejemplos:**

```bash
kj sonar status     # ¿Está SonarQube corriendo?
kj sonar start      # Arrancarlo
kj sonar open       # Abrir dashboard en http://localhost:9000
kj sonar logs       # Ver logs si algo va mal
kj sonar stop       # Parar cuando termines
```

---

## Variables de Entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `KJ_HOME` | Directorio de config y sesiones | `~/.karajan` |
| `KJ_SONAR_TOKEN` | Token de autenticación SonarQube | de config |
| `KJ_SONAR_PROJECT_KEY` | Clave de proyecto SonarQube | auto-detectada |
| `KJ_SONAR_ADMIN_USER` | Usuario admin SonarQube | `admin` |
| `KJ_SONAR_ADMIN_PASSWORD` | Contraseña admin SonarQube | de config |
| `SONAR_TOKEN` | Token SonarQube alternativo | fallback |
| `HU_BOARD_TOKEN` | Token Bearer para autenticacion del HU Board | — |
| `PG_API_URL` | URL del API del Planning Game; tiene prioridad sobre `planning_game.api_url` de la config (por defecto `http://localhost:3000/api`) | `https://pg.example.com/api` |
| `VISUAL` | Editor de texto para `kj config --edit` | fallback a `EDITOR` |
| `EDITOR` | Editor de texto fallback | `vi` |

---

## Códigos de Salida

| Código | Significado |
|--------|------------|
| `0` | Éxito |
| `1` | Error (comando fallido, error de validación, error de config, presupuesto excedido) |
