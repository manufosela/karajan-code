---
title: Varias cuentas de claude, codex y gh
description: Suscripción personal y de trabajo a la vez; Karajan usa la cuenta que elige tu sesión.
---

Puedes tener dos suscripciones del mismo CLI, por ejemplo una personal y otra del trabajo. Karajan no necesita ninguna opción propia para eso. Cada CLI ya tiene una variable que elige con qué cuenta trabaja, y Karajan la sigue:

| CLI | Variable | Por defecto |
|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | `~/.claude.json` y `~/.claude` |
| Codex | `CODEX_HOME` | `~/.codex` |
| GitHub CLI | `GH_CONFIG_DIR` | `~/.config/gh` |

Todo lo que se ejecuta dentro de una sesión hereda esas variables: `kj review`, los hooks de git, el Sentinel, el servidor MCP y `kj code`. El reviewer cruzado trabaja entonces con la cuenta de codex de esa sesión, y kj busca la sesión y la configuración de cada CLI en el mismo sitio.

## Configurar una segunda cuenta

Los nombres de abajo son solo un ejemplo (`trabajo`); usa el que quieras.

1. Elige una carpeta por cuenta, por ejemplo `~/.claude-trabajo`, `~/.codex-trabajo` y `~/.config/gh-trabajo`.
2. Arranca la sesión de trabajo con las tres variables. Basta un alias en el perfil de tu shell:

   ```sh
   alias claude-trabajo='CLAUDE_CONFIG_DIR=$HOME/.claude-trabajo CODEX_HOME=$HOME/.codex-trabajo GH_CONFIG_DIR=$HOME/.config/gh-trabajo claude'
   alias codex-trabajo='CODEX_HOME=$HOME/.codex-trabajo codex'
   ```

3. Para `gh`, crea un pequeño comando en vez de un alias, para que funcione también en los shells no interactivos donde los agentes ejecutan comandos. Guárdalo como `~/.local/bin/gh-trabajo` y hazlo ejecutable (`chmod 755`):

   ```sh
   #!/usr/bin/env sh
   GH_CONFIG_DIR="$HOME/.config/gh-trabajo" exec gh "$@"
   ```

4. Inicia sesión una vez en codex y en gh con la cuenta del trabajo:

   ```sh
   CODEX_HOME=$HOME/.codex-trabajo codex login
   gh-trabajo auth login
   ```

5. Abre una terminal nueva (para que exista el alias) y arranca `claude-trabajo` en el proyecto del trabajo.

Con una configuración de gh por cuenta no hay "cuenta activa" compartida: `gh auth switch` deja de hacer falta y ninguna sesión puede cambiar la cuenta que usa otra. Deja solo la cuenta personal en el `~/.config/gh` por defecto.

Las sesiones que arrancas con `claude` a secas siguen usando las cuentas por defecto. Las que ya estaban abiertas conservan las variables con las que arrancaron: reinícialas después de cambiar el alias.

## Comprobar qué cuenta revisa

Cuando la variable cambia de cuenta, `kj review --staged` la nombra en la línea del reviewer:

```text
kj review: host=claude → reviewer=codex (cross-AI) [CODEX_HOME=/home/tu/.codex-trabajo]
```

Con la cuenta por defecto no aparece el corchete. `kj doctor` comprueba también la configuración de codex de la cuenta elegida (`$CODEX_HOME/config.toml`).

## La cuenta de GitHub que usa kj

Cuando varias cuentas de `gh` comparten configuración, la activa es la misma para todas las sesiones, y otra sesión puede cambiarla mientras kj trabaja. Por eso kj no la usa (una configuración por cuenta, como arriba, evita el problema del todo): al arrancar toma el token de la cuenta del repo (`gh auth token --user <cuenta>`) y todos los `gh` que ejecuta usan ese. La cuenta es la dueña del remote `origin` (`git@github.com:tu/repo.git` → `tu`), siempre que `gh` la tenga con sesión iniciada. Para un repo de una organización, indica la cuenta en `.karajan/kj.config.yml`:

```yaml
review:
  github_account: tu-trabajo
```

Un `GH_TOKEN` o `GITHUB_TOKEN` ya definido (en CI, por ejemplo) se respeta siempre. Si la cuenta configurada no tiene sesión en `gh`, kj avisa y usa la activa.

## Conviene saber

- Un proceso de larga duración conserva la cuenta de la sesión que lo arrancó. Si lanzas `kj board start` desde una sesión personal, lo que el board lance usa las cuentas personales.
- La segunda cuenta de codex empieza con los valores por defecto de codex: sin el modelo, los servidores MCP ni los proyectos de confianza de la primera. `kj review` no necesita ninguno.
- Funciona igual sin alias: exporta las dos variables en el perfil de tu shell, en un `.envrc` o en el perfil de la terminal para ese proyecto.
