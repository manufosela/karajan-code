---
title: Configuración
description: Configura Karajan Code para tu proyecto — desde el setup rápido hasta ajuste avanzado del pipeline.
---

## Setup Rápido

Ejecuta `kj init` para generar tu fichero de configuración:

```bash
kj init
```

Esto crea `~/.karajan/kj.config.yml` con valores por defecto razonables. Ya puedes empezar — la mayoría de usuarios solo necesitan configurar `coder` y `reviewer`.

## Ubicación del Fichero de Configuración

| Fichero | Propósito |
|---------|-----------|
| `~/.karajan/kj.config.yml` | Configuración principal |
| `<proyecto>/.karajan/kj.config.yml` | Overrides a nivel de proyecto |
| `<proyecto>/.karajan.yml` | Overrides de pricing del proyecto |

Prioridad de override: **Flags CLI > config proyecto > config global > defaults**.

---

## Configuración Esencial

La configuración mínima para empezar:

```yaml
coder: claude
reviewer: codex
```

Eso es todo. Todo lo demás tiene valores por defecto. Lo siguiente que normalmente personalizarás:

```yaml
coder: claude
reviewer: codex
review_mode: standard        # paranoid | strict | standard | relaxed | custom
max_iterations: 5            # límite del bucle coder-reviewer
base_branch: main            # rama git para diffs

development:
  methodology: tdd           # tdd | standard
```

---

## Escenarios Comunes

### Activar Pipeline Completo

Activa todas las etapas del pipeline — triage, planner, tester, auditoría de seguridad y supervisor:

```yaml
pipeline:
  triage:
    enabled: true
  planner:
    enabled: true
  tester:
    enabled: true
  security:
    enabled: true
  solomon:
    enabled: true
```

O vía CLI:

```bash
kj run "mi tarea" --enable-triage --enable-planner --enable-tester --enable-security --enable-solomon
```

### Usar Diferentes Agentes IA por Rol

Asigna providers y modelos específicos a cada rol:

```yaml
roles:
  coder:
    provider: claude
    model: claude-opus-4-6
  reviewer:
    provider: codex
  planner:
    provider: claude
  security:
    provider: claude
```

### Automatización Git

Automatiza commit, push y creación de PR tras completar el pipeline:

```yaml
git:
  auto_commit: true
  auto_push: true
  auto_pr: true
  auto_rebase: true
  branch_prefix: feat/
```

### BecarIA Gateway

Publica los resultados del pipeline como comentarios y reviews en PRs de GitHub mediante una identidad de bot de GitHub App:

```yaml
becaria:
  enabled: true
  review_event: becaria-review
  comment_event: becaria-comment
  comment_prefix: true
```

BecarIA activa automáticamente `git.auto_commit`, `git.auto_push` y `git.auto_pr`. Ver [Flujos del Pipeline](/docs/es/guides/flows/) para la arquitectura completa.

### SonarQube

SonarQube está activado por defecto. Para usar un servidor externo en vez del contenedor Docker gestionado:

```yaml
sonarqube:
  enabled: true
  external: true
  host: https://sonar.miempresa.com
  token: null   # Usa la variable KJ_SONAR_TOKEN en su lugar
```

Para desactivar SonarQube:

```yaml
sonarqube:
  enabled: false
```

### Control de Presupuesto

Establece un límite de gasto por sesión:

```yaml
max_budget_usd: 5.00

budget:
  warn_threshold_pct: 80
  currency: usd
```

### Integración con Planning Game

Conecta con un sistema de gestión de proyectos Planning Game:

```yaml
planning_game:
  enabled: true
  project_id: "Mi Proyecto"
  codeveloper: dev_001
```

O vía CLI:

```bash
kj run "implementar KJC-TSK-0042" --pg-task KJC-TSK-0042 --pg-project "Mi Proyecto"
```

### Selección Inteligente de Modelos

Deja que Karajan elija automáticamente el mejor tier de modelo según la complejidad de la tarea:

```yaml
model_selection:
  enabled: true
  tiers:
    fast:
      model: claude-sonnet-4-6
    balanced:
      model: claude-opus-4-6
  role_overrides:
    reviewer:
      model: claude-opus-4-6
```

### Fail-Fast ante Errores Repetidos

Detiene el pipeline cuando el mismo error se repite:

```yaml
failFast:
  repeatThreshold: 2    # salir tras 2 fallos idénticos
```

---

## Variables de Entorno

| Variable | Propósito |
|----------|-----------|
| `KJ_HOME` | Override del directorio de config/sesiones (default: `~/.karajan`) |
| `KJ_SONAR_TOKEN` | Token de autenticación de SonarQube |
| `KJ_SONAR_ADMIN_USER` | Usuario admin de SonarQube |
| `KJ_SONAR_ADMIN_PASSWORD` | Contraseña admin de SonarQube |
| `KJ_SONAR_PROJECT_KEY` | Override del project key de SonarQube |
| `VISUAL` / `EDITOR` | Editor para `kj config --edit` |

Las variables de entorno tienen precedencia sobre los valores del fichero de configuración.

---

## Instrucciones de Rol Personalizadas

Sobreescribe los prompts built-in de cualquier rol colocando ficheros Markdown:

```
# A nivel de proyecto (máxima prioridad)
<proyecto>/.karajan/roles/coder.md
<proyecto>/.karajan/roles/reviewer.md

# Global
~/.karajan/roles/reviewer-paranoid.md
```

Ver [Referencia de Configuración](/docs/es/reference/configuration/) para la referencia completa de campos.
