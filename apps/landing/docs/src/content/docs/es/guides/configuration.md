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
| `<proyecto>/.karajan/kj.config.yml` | Overrides a nivel de proyecto, compartidos por el equipo |
| `<proyecto>/.karajan/kj.config.local.yml` | Tus preferencias para este proyecto, nunca se commitean |
| `<proyecto>/.karajan.yml` | Overrides de pricing del proyecto |

Prioridad de override: **Flags CLI > config local > config proyecto > config global > defaults**.

Desde v1.57.1, el cargador de config YAML tolera claves duplicadas en ficheros de configuracion del usuario. Si una clave aparece mas de una vez, el ultimo valor gana sin producir error.

---

## Configuracion Esencial

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
  discover:
    provider: claude
  hu-reviewer:
    provider: claude
    # Auto-activado por triage para tareas medias/complejas (v1.38.0+)
  audit:
    provider: claude
  impeccable:
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

### Tracking de Presupuesto (Estimado)

Karajan **no tiene coste adicional** — ejecuta agentes CLI (Claude Code, Codex, etc.) bajo tus suscripciones existentes. El sistema de budget cuenta tokens y estima lo que la sesión *habría costado* si usaras las APIs directamente, basándose en las tarifas publicadas. Es útil para comparar enfoques y establecer guardarraíles, no para facturación.

```yaml
max_budget_usd: 5.00

budget:
  warn_threshold_pct: 80
  currency: usd
```

### Integración con Planning Game

Conecta con [Planning Game](https://github.com/manufosela/planning-game-xp), un sistema de gestión de proyectos ágil (metodología XP) con integración MCP:

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

### Resolucion de Modelo/Provider (v1.57.2+)

Cuando el campo `model` usa un formato con prefijo como `gemini/pro`, Karajan infiere automaticamente el provider del prefijo y lo elimina del nombre del modelo. Por ejemplo, `model: "gemini/pro"` se resuelve como `provider: gemini, model: pro`. Si se establece un provider explicitamente y el prefijo del modelo entra en conflicto (ej. `provider: claude` con `model: gemini/pro`), el modelo incompatible se descarta y se usa el modelo por defecto del provider. Esto hace la configuracion mas tolerante y reduce errores de misconfiguracion.

### Seleccion Inteligente de Modelos

Deja que Karajan elija automaticamente el mejor tier de modelo segun la complejidad de la tarea:

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

### Routing de modelo por HU

Cuando una tarea se ejecuta en varias HUs, el coder de cada HU corre con el modelo que pide su tramo, para que las HUs sencillas no paguen el modelo más capaz. El tramo sale de la descomposición: el número de criterios de aceptación, las zonas sensibles (auth, secretos, migraciones, seguridad) y el juicio del propio planner; gana el más alto.

| Tramo de la HU | Primera iteración (claude) | Tras una iteración fallida |
|----------------|----------------------------|----------------------------|
| trivial | `haiku`, effort `low` | `opus`, effort `max` |
| estándar | `sonnet`, effort `medium` | `opus`, effort `max` |
| deep | el modelo de siempre | `opus`, effort `max` |

`kj plan` escribe el `coder_model` de cada HU a partir de su tramo, y puedes cambiarlo en el HU Board: la ejecución usa el tuyo. Solo se enruta el coder; el reviewer y Solomon mantienen su modelo. Un modelo que hayas elegido siempre gana (`roles.coder.model`, `--coder-model`, `model_profile`, `model_routing.fixed.coder`). El effort solo se aplica a claude.

```yaml
model_routing:
  enabled: false          # apaga el routing en este proyecto
  by_provider:            # otros modelos por nivel
    claude: { trivial: claude-haiku-5-5, medium: claude-sonnet-5-5, complex: claude-opus-5-5 }
```

`by_provider` nombra niveles de modelo, no tramos: una HU trivial usa `trivial`, una estándar `medium`, y la subida tras un fallo `complex`.

`kj report` muestra, por modelo del coder, el coste y los fallos a la primera, y cuántas HUs se enrutaron y cuántas subieron al modelo máximo, para que veas si el routing compensa.

### Idioma (i18n)

Configura el idioma de los mensajes del pipeline y las historias de usuario:

```yaml
language: en             # Idioma del pipeline (en | es). Auto-detectado del locale del SO por kj init
hu_language: en          # Idioma de las historias de usuario / HUs (en | es). Independiente del idioma del pipeline
```

Los agentes responden en el idioma configurado en `language`. El campo `hu_language` controla el idioma usado para generar historias de usuario (HUs) y criterios de aceptacion. Ambos valores por defecto son ingles y se pueden configurar de forma independiente.

### Telemetria

Karajan recopila estadisticas de uso anonimas (version, SO, comando, duracion del pipeline, tasa de exito) para mejorar la herramienta. No se recopilan descripciones de tareas, codigo ni informacion personal. La telemetria esta activada por defecto.

Para desactivarla:

```yaml
telemetry: false
```

O mediante variable de entorno: `KJ_TELEMETRY=false`.

### Autenticacion del HU Board

Protege tu dashboard HU Board con un token Bearer:

```yaml
hu_board:
  token: "tu-token-secreto"
```

O mediante variable de entorno: `HU_BOARD_TOKEN=tu-token-secreto`. Cuando se configura, todas las peticiones al API del HU Board requieren una cabecera `Authorization: Bearer <token>`.

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
| `HU_BOARD_TOKEN` | Token Bearer para autenticacion del HU Board |
| `KJ_TELEMETRY` | Establecer a `false` para desactivar telemetria |
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
