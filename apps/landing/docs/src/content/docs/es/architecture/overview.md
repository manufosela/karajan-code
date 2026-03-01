---
title: Visión General de la Arquitectura
description: Arquitectura de alto nivel de Karajan Code.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

## Estructura de Módulos

Karajan Code está organizado como una aplicación CLI en Node.js con los siguientes módulos clave:

- **`src/process.js`** — Orquestador principal del pipeline
- **`src/agents/`** — Registro de agentes y adaptadores (Claude, Codex, Gemini, Aider)
- **`src/sonar/`** — Integración con SonarQube (API, gestión Docker, scanner)
- **`src/session/`** — Gestión de sesiones (crear, reanudar, pausar, limpieza)
- **`src/plugins/`** — Descubrimiento y carga de plugins
- **`src/utils/`** — Utilidades compartidas (retry, fs, paths, git)
- **`templates/roles/`** — Templates Markdown para cada rol del pipeline

## Inspiraciones

La arquitectura ha sido influenciada por [jorgecasar/legacy-s-end-2](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration), que usa una arquitectura hexagonal limpia con puertos y adaptadores para orquestación de IA.
