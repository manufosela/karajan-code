---
title: Instalación
description: Cómo instalar Karajan Code.
---

:::caution[Docs de v3 (legacy)]
Estás leyendo la documentación del pipeline headless v3. Karajan v4 se une al agente de IA con el que ya trabajas — empieza en [Instalación (v4)](/docs/es/v4/install/).
:::

## Requisitos

El binario `kj` incluye su propio runtime, pero **orquesta herramientas externas** — no las instala. Tras instalar, ejecuta `kj doctor` para comprobar tu máquina.

**Requerido** (kj no funciona sin esto):

- **git** — Karajan trabaja sobre repositorios git
- **Al menos un CLI de agente de IA** — Claude, Codex, Gemini, Aider u OpenCode (ver Paso 1)

**Opcional** (cada uno habilita funciones extra):

- **Docker** — modelos locales y análisis estático con SonarQube. Desactiva Sonar con `--no-sonar` o `sonarqube.enabled: false`
- **Node.js >= 22.12 / npm** — requerido por la vía de instalación npm (`engines.node`; con un Node más viejo, npm instala EN SILENCIO una versión ANTIGUA de karajan-code que aún lo soporte) y por las herramientas auxiliares (Squeezr, qmd)

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

La vía recomendada es el **binario standalone** — un único ejecutable autónomo. El instalador descarga el binario para tu plataforma, verifica su checksum SHA256 y deja `kj` en tu PATH.

### Linux (x64)

```bash
curl -fsSL https://karajancode.com/install.sh | sh
```

### Windows (x64, PowerShell)

```powershell
irm https://karajancode.com/install.ps1 | iex
```

### macOS (Apple Silicon)

```bash
curl -fsSL https://karajancode.com/install.sh | sh
```

### Vía npm (cualquier plataforma, Node.js 18+)

Instala con npm en los Mac Intel o en cualquier plataforma donde prefieras ejecutar `kj` sobre Node:

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

## Alternativa: Docker

Ejecuta Karajan Code en un contenedor (Alpine + Node 20) — todo va dentro de la imagen:

```bash
docker run --rm -it ghcr.io/manufosela/karajan-code kj doctor
```

O usalo como imagen base para pipelines de CI:

```dockerfile
FROM ghcr.io/manufosela/karajan-code
COPY . /workspace
WORKDIR /workspace
RUN kj init --non-interactive --coder claude --reviewer codex
```

## Alternativa: Wrapper Python (pip install)

Si prefieres instalar via pip:

```bash
cd wrappers/python && pip install .
```

Esto instala el comando `kj` mediante un wrapper Python que delega al CLI de Node.js.

## Alternativa: Descarga manual del binario (fijar versión)

Si prefieres descargar una versión concreta manualmente en lugar de usar el instalador de una línea, coge el binario para tu plataforma desde [GitHub Releases](https://github.com/manufosela/karajan-code/releases):

```bash
# Linux x64
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-linux-x64 -o kj && chmod +x kj

# macOS (Apple Silicon)
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-darwin-arm64 -o kj && chmod +x kj

# Windows (PowerShell)
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-win-x64.exe -o kj.exe
```

Mueve el binario a un directorio en tu PATH (ej. `/usr/local/bin/kj`). Los checksums SHA256 están disponibles junto a cada binario. El binario de macOS es `kj-darwin-arm64` (Apple Silicon); los Mac Intel se instalan vía npm.

## Alternativa: Homebrew (macOS)

```bash
brew install manufosela/tap/karajan-code
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
