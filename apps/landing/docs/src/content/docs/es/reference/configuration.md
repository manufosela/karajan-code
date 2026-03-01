---
title: Referencia de Configuración
description: Referencia completa de todos los campos de kj.config.yml.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

## Ejemplo de Configuración Completa

```yaml
# Agentes IA
coder: claude
reviewer: codex

# Configuración de revisión
review_mode: standard          # standard | strict | paranoid | relaxed
max_iterations: 5
base_branch: main

# Metodología de desarrollo
development:
  methodology: tdd             # tdd | standard
  require_test_changes: true

# SonarQube
sonarqube:
  enabled: true
  host: http://localhost:9000

# Automatización Git
git:
  auto_commit: false
  auto_push: false
  auto_pr: false

# Límites de sesión
session:
  max_iteration_minutes: 15
  max_total_minutes: 120
  expiry_days: 30
```
