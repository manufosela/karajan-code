---
title: Instalación
description: Cómo instalar Karajan Code.
---

## Requisitos

- **Node.js** >= 18
- **Docker** — necesario para el análisis estático con SonarQube. Si no tienes Docker o no necesitas SonarQube, desactívalo con `--no-sonar` o `sonarqube.enabled: false` en la config
- Al menos un agente de IA instalado: Claude, Codex, Gemini, Aider u OpenCode

## Paso 1: Instala al menos un agente de IA

Necesitas al menos un agente instalado antes de ejecutar `kj init`. Instala uno o más:

| Agente | CLI | Instalación |
|--------|-----|-------------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | Ver [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pip install aider-chat` |
| **OpenCode** | `opencode` | Ver [opencode.ai](https://opencode.ai) |

## Paso 2: Instala Karajan Code

```bash
npm install -g karajan-code
```

## Paso 3: Ejecuta el wizard de configuración

```bash
kj init
```

El wizard auto-detecta tus agentes instalados y te guía en la configuración:

1. **Seleccionar agente coder por defecto** — Qué IA escribe el código (ej: Claude)
2. **Seleccionar agente reviewer por defecto** — Qué IA revisa el código (ej: Codex)
3. **¿Activar triage?** — Clasificar automáticamente la complejidad de las tareas para activar solo los roles necesarios (por defecto: No)
4. **¿Activar SonarQube?** — Análisis estático con quality gates via Docker (por defecto: Sí)
5. **Metodología de desarrollo** — TDD (test-driven, recomendado) o Standard

:::tip[¿Solo un agente?]
Si solo tienes un agente instalado, `kj init` lo asigna automáticamente a los roles de coder y reviewer. Puedes cambiarlo después en la config.
:::

Al completar el wizard, se crean:

- **`~/.karajan/kj.config.yml`** — Fichero principal de configuración (o `$KJ_HOME/kj.config.yml`)
- **`review-rules.md`** — Directrices de revisión por defecto (en el directorio del proyecto)
- **`coder-rules.md`** — Directrices del coder por defecto (en el directorio del proyecto)

Si SonarQube está activado, el wizard también inicia un contenedor Docker (`karajan-sonarqube`) y proporciona instrucciones para generar tu token de SonarQube.

## Paso 4: Verifica la instalación

```bash
kj doctor
```

Esto verifica tu entorno completo: git, Docker, conectividad con SonarQube, CLIs de agentes y ficheros de reglas. Corrige cualquier problema que reporte antes de ejecutar tu primera tarea.

## Alternativa: Instalar desde código fuente

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
./scripts/install.sh
```

## Alternativa: Setup no interactivo (CI/automatización)

Para pipelines de CI o entornos automatizados donde no puedes ejecutar el wizard interactivo:

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

## Configuración del Token de SonarQube

Si activaste SonarQube durante `kj init`:

1. Abre http://localhost:9000 en tu navegador
2. Inicia sesión con las credenciales por defecto (`admin` / `admin`) — te pedirá cambiar la contraseña
3. Ve a **My Account → Security → Generate Tokens**
4. Crea un **Global Analysis Token**
5. Añádelo a tu config:

```yaml
# En ~/.karajan/kj.config.yml
sonarqube:
  token: "tu-token-aqui"
```

O establece la variable de entorno:

```bash
export KJ_SONAR_TOKEN="tu-token-aqui"
```

## Opcional: Instalar RTK para Ahorro de Tokens

[RTK](https://github.com/rtk-ai/rtk) (Rust Token Killer) reduce el consumo de tokens en un 60-90% en las salidas de comandos Bash. Instálalo globalmente y KJ se beneficia automáticamente:

```bash
brew install rtk
rtk init --global
```

Consulta [RTK en GitHub](https://github.com/rtk-ai/rtk) para más detalles.

## Siguientes Pasos

- [Inicio Rápido](/docs/es/getting-started/quick-start/) — Ejecutar tu primera tarea
