# Primeros pasos con Karajan Code

## Requisitos previos

- Node.js ≥ 18
- Git
- Al menos una CLI de IA instalada: `claude`, `codex`, `gemini`, `aider` u `opencode`
- (Opcional) Docker para SonarQube local
- (Opcional) RTK para ahorro de tokens: `cargo install rtk`

## Instalación

```bash
npm install -g karajan-code
```

Verifica:
```bash
kj --version    # 2.0.0
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
4. Ejecuta pipeline: triage → coder → reviewer → tester → security → audit

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
kj plan "tarea"               # Solo planificación, sin implementar
kj review                     # Review de cambios no commiteados
kj audit                      # Auditar toda la base de código
kj status                     # Estado de la sesión actual
kj resume <session-id>        # Reanudar sesión pausada
kj doctor                     # Comprobar entorno
```

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

## Dónde viven las sesiones

- `.karajan/sessions/s_<timestamp>/` — estado de la sesión
- `.reviews/session_<timestamp>/` — ficheros de journal (triage.md, plan.md, iterations.md, summary.md, ...)

## Visualización del pipeline

Consulta [ARCHITECTURE.md](../ARCHITECTURE.md) para el diagrama completo de arquitectura y la documentación de componentes.

## Troubleshooting

Problemas comunes: [troubleshooting.md](../troubleshooting.md)

## Siguientes pasos

- Lee [ARCHITECTURE.md](../ARCHITECTURE.md) para entender el pipeline
- Revisa [SKILLS.md](../SKILLS.md) para la integración con OpenSkills
- Navega [templates/roles/](../../templates/roles/) para ver las definiciones de roles
- Si migras desde v1: [MIGRATION-v2.md](../../MIGRATION-v2.md)
