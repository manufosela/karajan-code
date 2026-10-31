---
title: Varias cuentas de claude y codex
description: Suscripción personal y de trabajo a la vez; Karajan usa la cuenta que elige tu sesión.
---

Puedes tener dos suscripciones del mismo CLI, por ejemplo una personal y otra del trabajo. Karajan no necesita ninguna opción propia para eso. Cada CLI ya tiene una variable que elige con qué cuenta trabaja, y Karajan la sigue:

| CLI | Variable | Por defecto |
|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | `~/.claude.json` y `~/.claude` |
| Codex | `CODEX_HOME` | `~/.codex` |

Todo lo que se ejecuta dentro de una sesión hereda esas variables: `kj review`, los hooks de git, el Sentinel, el servidor MCP y `kj code`. El reviewer cruzado trabaja entonces con la cuenta de codex de esa sesión, y kj busca la sesión y la configuración de cada CLI en el mismo sitio.

## Configurar una segunda cuenta

Los nombres de abajo son solo un ejemplo (`trabajo`); usa el que quieras.

1. Elige una carpeta por cuenta, por ejemplo `~/.claude-trabajo` y `~/.codex-trabajo`.
2. Arranca la sesión de trabajo con las dos variables. Basta un alias en el perfil de tu shell:

   ```sh
   alias claude-trabajo='CLAUDE_CONFIG_DIR=$HOME/.claude-trabajo CODEX_HOME=$HOME/.codex-trabajo claude'
   alias codex-trabajo='CODEX_HOME=$HOME/.codex-trabajo codex'
   ```

3. Inicia sesión en codex una vez con la cuenta del trabajo:

   ```sh
   CODEX_HOME=$HOME/.codex-trabajo codex login
   ```

4. Abre una terminal nueva (para que exista el alias) y arranca `claude-trabajo` en el proyecto del trabajo.

Las sesiones que arrancas con `claude` a secas siguen usando las cuentas por defecto. Las que ya estaban abiertas conservan las variables con las que arrancaron: reinícialas después de cambiar el alias.

## Comprobar qué cuenta revisa

Cuando la variable cambia de cuenta, `kj review --staged` la nombra en la línea del reviewer:

```text
kj review: host=claude → reviewer=codex (cross-AI) [CODEX_HOME=/home/tu/.codex-trabajo]
```

Con la cuenta por defecto no aparece el corchete. `kj doctor` comprueba también la configuración de codex de la cuenta elegida (`$CODEX_HOME/config.toml`).

## Conviene saber

- Un proceso de larga duración conserva la cuenta de la sesión que lo arrancó. Si lanzas `kj board start` desde una sesión personal, lo que el board lance usa las cuentas personales.
- La segunda cuenta de codex empieza con los valores por defecto de codex: sin el modelo, los servidores MCP ni los proyectos de confianza de la primera. `kj review` no necesita ninguno.
- Funciona igual sin alias: exporta las dos variables en el perfil de tu shell, en un `.envrc` o en el perfil de la terminal para ese proyecto.
