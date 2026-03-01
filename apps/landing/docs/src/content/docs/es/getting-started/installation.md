---
title: Instalación
description: Cómo instalar Karajan Code.
---

## Requisitos

- **Node.js** >= 18
- **Docker** — necesario para el análisis estático con SonarQube. Si no tienes Docker o no necesitas SonarQube, desactívalo con `--no-sonar` o `sonarqube.enabled: false` en la config
- Al menos un agente de IA instalado: Claude, Codex, Gemini o Aider

## Desde npm (recomendado)

```bash
npm install -g karajan-code
kj init
```

`kj init` ejecuta un wizard interactivo que auto-detecta los agentes instalados y te guía en la selección de coder/reviewer, configuración de SonarQube y elección de metodología.

## Desde código fuente

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
./scripts/install.sh
```

## Setup no interactivo (CI/automatización)

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

## Agentes Soportados

| Agente | CLI | Instalación |
|--------|-----|-------------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | Ver [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pip install aider-chat` |

`kj init` auto-detecta los agentes instalados. Si solo hay uno disponible, se asigna a todos los roles automáticamente.

## Verificar la Instalación

```bash
kj doctor
```

Esto verifica tu entorno: git, Docker, SonarQube, CLIs de agentes y ficheros de reglas.

## Siguientes Pasos

- [Inicio Rápido](/docs/es/getting-started/quick-start/) — Ejecutar tu primera tarea
