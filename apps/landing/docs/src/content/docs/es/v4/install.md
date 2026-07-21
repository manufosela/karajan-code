---
title: Instalación
description: Monta el Entorno Karajan en un proyecto en menos de cinco minutos.
---

Karajan v4 se une al agente de IA con el que ya trabajas (Claude Code, Codex, Gemini CLI, Cursor). Se instala una vez por máquina, se activa una vez por proyecto, y desde ahí tu agente sigue el método y git lo hace cumplir.

## 1. Instala kj

```bash
npm install -g karajan-code
```

O el binario standalone (sin Node): `curl -fsSL https://karajancode.com/install.sh | sh`.
**Nota:** el binario standalone cubre todo el CLI pero no el servidor MCP opcional (limitación de módulos nativos). Si necesitas MCP, usa la instalación npm.

Requiere Node ≥ 22.12 (instalación npm) y git. Al menos un CLI de agente de IA en el PATH; con dos hay revisión cruzada; con tres, arbitraje.

## 2. Activa el entorno en tu proyecto

```bash
kj init                    # config, reglas, tooling de calidad (wizard; seguro para agentes sin TTY)
kj env install             # escribe el método en CLAUDE.md, AGENTS.md y GEMINI.md + construye el índice RAG
kj harden                  # hooks de git: lint, política de commits, el runner del gate de revisión
kj review --install-gate   # opt-in: los commits EXIGEN veredicto de IA cruzada
```

Commitea los ficheros del contrato generados (`.karajan/review-gate`, `.karajan/hooks/`, los ficheros de reglas de agente) — quien clone el repo hereda el entorno. Cada clon ejecuta una vez `git config core.hooksPath .karajan/hooks`.

## 3. Encárgaselo a tu agente

Eso es todo el setup. Desde aquí hablas con tu agente, no con kj. Un primer prompt que funciona:

```
Este proyecto corre bajo el Entorno Karajan. Lee el bloque "Karajan method (v4)"
en el fichero de reglas del proyecto y síguelo en todo lo que hagamos:
RAG antes de suponer, tests primero, revisión IA-cruzada antes de cada commit.
```

Tu agente descubrirá el resto (`kj brief`, `kj solomon`, `kj report-issue`) desde el propio playbook.

## Desinstalar / desactivar

Cada gate es un fichero visible: borra `.karajan/review-gate` para desactivar el gate de revisión, quita `core.hooksPath` para desactivar los hooks, elimina el bloque gestionado de los ficheros de reglas para retirar el método. No hay nada oculto.
