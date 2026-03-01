---
title: FAQ
description: Frequently asked questions about Karajan Code.
---

:::note
This page is under construction. Full content coming soon.
:::

## General

### What AI agents does Karajan Code support?

Claude, Codex, Gemini, and Aider. You can mix and match — use one as coder and another as reviewer.

### Does it cost money?

Karajan Code itself is free and open source (AGPL-3.0). It runs on your existing AI agent subscriptions — no additional API keys needed.

### Do I need Docker?

Docker is only required for SonarQube static analysis. You can skip it with `--no-sonar` or `sonarqube.enabled: false`.

## Troubleshooting

### `kj doctor` reports agent not found

Make sure the agent CLI is installed globally and in your PATH. Run `which claude` (or `codex`, `gemini`, `aider`) to verify.

### SonarQube analysis times out

Check that the Docker container is running: `docker ps | grep sonarqube`. If not, start it with `kj sonar start`.
