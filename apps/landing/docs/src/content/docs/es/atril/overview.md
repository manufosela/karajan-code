---
title: 'Visión general'
description: 'Qué es atril, cómo funciona su almacén y cuándo usarlo.'
---

<!-- translated-from: atril/overview.md · source-sha256: 16e80fb68fdc4a126a0b4fce189b96284dc4e1eae9982a3b2bbd6d026fbdc89f -->

Skills, comandos y subagentes para cualquier CLI de IA, bajo demanda.

Un agente carga todas las skills y comandos que encuentra al iniciar una sesión, y cada una consume contexto la necesite la tarea o no. atril las guarda en un **almacén** (store), encuentra las que necesita una tarea y devuelve los ficheros que hay que leer. Claude Code, Codex, OpenCode y cualquier CLI que lea Markdown pueden usar el mismo almacén.

atril es un módulo de la familia [Karajan](https://karajancode.com). No importa nada de Karajan: Karajan lo invoca exactamente igual que cualquier otro proyecto.

## Instalación

```sh
npm install -g @karajan-family/atril
atril --version
```

Node.js 22.12 o superior.

## El almacén

Un almacén es una carpeta con un directorio por tipo, con la estructura que ya usan los CLI:

```
.atril/
  skills/<name>/SKILL.md      a skill: a folder, so it can carry references
  commands/<name>.md          a command
  agents/<name>.md            a subagent
  atril.json                  the store's config
```

Cada artefacto es Markdown con frontmatter y declara como mínimo `name`, `description` y `kind`:

```markdown
---
name: review
description: Review a pull request for correctness and risk
kind: command
---
Read the diff, then...
```

La raíz es `.atril/` por defecto; `--root <dir>` o `ATRIL_ROOT` la cambian (Karajan usa `.karajan/`). También se lee un almacén a nivel de usuario en `~/.atril` (o `ATRIL_USER_ROOT`); si hay un conflicto, gana el artefacto del proyecto.
