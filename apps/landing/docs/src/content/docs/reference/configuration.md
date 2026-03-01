---
title: Configuration Reference
description: Complete reference of all kj.config.yml fields.
---

:::note
This page is under construction. Full content coming soon.
:::

## Full Configuration Example

```yaml
# AI Agents
coder: claude
reviewer: codex

# Review settings
review_mode: standard          # standard | strict | paranoid | relaxed
max_iterations: 5
base_branch: main

# Development methodology
development:
  methodology: tdd             # tdd | standard
  require_test_changes: true

# SonarQube
sonarqube:
  enabled: true
  host: http://localhost:9000

# Git automation
git:
  auto_commit: false
  auto_push: false
  auto_pr: false

# Session limits
session:
  max_iteration_minutes: 15
  max_total_minutes: 120
  expiry_days: 30
```
