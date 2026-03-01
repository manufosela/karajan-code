---
title: FAQ
description: Preguntas frecuentes sobre Karajan Code.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

## General

### ¿Qué agentes de IA soporta Karajan Code?

Claude, Codex, Gemini y Aider. Puedes combinarlos — usa uno como coder y otro como reviewer.

### ¿Tiene coste?

Karajan Code es gratuito y open source (AGPL-3.0). Funciona con tus suscripciones existentes de agentes IA — no necesita API keys adicionales.

### ¿Necesito Docker?

Docker solo es necesario para el análisis estático con SonarQube. Puedes omitirlo con `--no-sonar` o `sonarqube.enabled: false`.

## Troubleshooting

### `kj doctor` reporta que no encuentra un agente

Asegúrate de que el CLI del agente está instalado globalmente y en tu PATH. Ejecuta `which claude` (o `codex`, `gemini`, `aider`) para verificar.

### El análisis SonarQube da timeout

Comprueba que el contenedor Docker está corriendo: `docker ps | grep sonarqube`. Si no, inícialo con `kj sonar start`.
