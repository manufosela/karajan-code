---
title: Blindar tu entorno frente a la IA
description: Protege tu entorno de desarrollo de las herramientas de IA — funciona uses Karajan o no.
---

Cuando delegas trabajo en herramientas de IA (Claude Code, Codex, Aider, Cursor, Gemini CLI, etc.), se ejecutan con **todos tus permisos de usuario**. Pueden leer, escribir, borrar, hacer push, force-push y llamar a cualquier API externa que tu shell pueda alcanzar. Es así por diseño — quieres que hagan trabajo de verdad — pero implica que necesitas una estrategia de defensa que **no** dependa de que la IA se comporte bien.

Esta guía es **agnóstica a la IA y a la herramienta**. Sirve uses Karajan, Claude Code a pelo, Codex, o cualquier otra cosa.

## El modelo mental incorrecto

> "Voy a añadir `rm -rf` a mi denylist."

Es la guerra del topo. Por cada comando peligroso que bloqueas, la IA encuentra otro:

| Bloqueado | Equivalente |
|---|---|
| `rm -rf` | `find -delete` |
| `find -delete` | `python -c "shutil.rmtree(...)"` |
| `python` | `node -e "fs.rmSync(...)"` |
| `node` | `perl -e "unlink ..."` |

Tendrías que enumerar todos los comandos shell, todos los intérpretes, todas las APIs de filesystem de cada lenguaje. No puedes.

## El modelo mental correcto

**Defensa en profundidad, con capas que no dependen de enumerar comportamientos malos.** Las capas fuertes son a nivel kernel y server-side; lo demás es refuerzo.

## Capa 1 — Recuperación: asume que algo se romperá

Backups cifrados periódicos a un destino que tú controlas. El objetivo no es "evitar daño" sino "que recuperar sea barato y fiable".

**Recomendado**: [BorgBackup](https://www.borgbackup.org/) a un NAS local, diario, con deduplicación y cifrado AES.

```bash
# Inicializar repo
borg init --encryption=repokey-blake2 user@nas:/path/to/borg-repo

# Snapshot diario
export BORG_PASSCOMMAND="cat ~/.config/borg/passphrase"
borg create user@nas:/path/to/borg-repo::"$(date +%Y%m%dT%H%M%S)" \
  ~/projects \
  --exclude '**/node_modules' \
  --exclude '**/dist' \
  --exclude '**/.cache'

# Retención: 7 diarios, 4 semanales, 6 mensuales
borg prune user@nas:/path/to/borg-repo \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6
```

Si una IA borra algo que necesitabas, recuperarlo es un `borg extract`.

## Capa 2 — Prevención: usuario Linux restringido aparte

Es la **capa más fuerte**. Crea un usuario dedicado (p. ej. `ia-user`) para ejecutar herramientas de IA. El kernel mismo aplica qué puede leer y escribir.

**Por qué funciona**: una IA ejecutándose como `ia-user` no puede escapar de su UID. Ningún `find -delete`, ningún script de Python, ningún syscall exótico puede saltárselo. El kernel devuelve `EACCES` antes de que la IA siquiera intente la operación.

```bash
# 1. Crear usuario
sudo useradd -m -s /bin/bash ia-user
sudo passwd ia-user

# 2. Permitir a ia-user atravesar tu home y leer carpetas de proyectos
setfacl -m u:ia-user:--x /home/$USER
setfacl -R -m u:ia-user:r-X /home/$USER/projects
setfacl -dR -m u:ia-user:r-X /home/$USER/projects

# 3. Clave SSH propia para ia-user, registrada en GitHub
sudo -u ia-user ssh-keygen -t ed25519 \
  -f /home/ia-user/.ssh/id_ed25519 -N ""
gh ssh-key add /home/ia-user/.ssh/id_ed25519.pub \
  --title "ia-user@$(hostname)"

# 4. Hacer descubrible claude (u otra CLI)
sudo ln -s "$(which claude)" /usr/local/bin/claude
```

**Flujo por proyecto**: das escritura solo mientras trabajas activamente, y luego la quitas.

```bash
# Conceder escritura
setfacl -R -m u:ia-user:rwX ~/projects/active-project
setfacl -dR -m u:ia-user:rwX ~/projects/active-project

# Ejecutar la IA como ia-user
sudo -i -u ia-user
cd /home/$TU_USUARIO/projects/active-project
claude   # o codex, gemini, aider...
```

**Un único usuario restringido sirve para todas las CLIs de IA.** Claude Code, Codex, Aider, Gemini CLI, Cursor — todas se ejecutan bajo el mismo UID y heredan las mismas restricciones. Una configuración protege todo el ecosistema.

## Capa 3 — Inmutabilidad para archivos críticos

Para archivos que nunca deben cambiar (claves SSH, configs de identidad):

```bash
sudo chattr +i ~/.ssh/id_ed25519
sudo chattr +i ~/.ssh/id_ed25519.pub
sudo chattr +i ~/.ssh/config
```

Una vez fijado, ni siquiera `sudo rm -rf` puede borrar el archivo. Para modificarlo legítimamente, primero `sudo chattr -i <archivo>`.

## Capa 4 — Protección server-side en Git hosts

El remoto debe aplicar sus propias reglas, independiente de tu entorno local.

### Branch protection (GitHub)

Bloquea force-push y borrado de `main` en cada repo:

```bash
gh api -X POST repos/OWNER/REPO/rulesets --input - <<EOF
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["refs/heads/main", "refs/heads/master"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ],
  "bypass_actors": []
}
EOF
```

### Scopes del token

No incluyas `delete_repo` en el scope de tu token de GitHub. Sin ese scope, ninguna IA puede borrar tus repos vía API por mucho que lo intente.

```bash
gh auth status   # verifica scopes; asegúrate de que delete_repo NO aparece
```

## Capa 5 — Reglas deny específicas por herramienta

Es la **capa más débil** pero útil para cazar errores obvios.

Ejemplo para Claude Code (`~/.claude/settings.json`):

```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf*)",
      "Bash(rm -fr*)",
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git reset --hard*)",
      "Bash(git branch -D*)",
      "Bash(gh repo delete*)",
      "Bash(gh api -X DELETE*)"
    ]
  }
}
```

## Capa 6 — Pre-commit hooks contra atribución a IA

Si tu política es "sin referencias a IA en commits/PRs":

- **Local**: hook pre-commit / commit-msg que bloquee patrones tipo `Co-Authored-By: Claude`, `generated by AI`, etc.
- **Server-side**: GitHub Action que revise body de PRs, issues, mensajes de commit y comentarios de review.

Implementación de referencia: [`@geniova/git-hooks`](https://github.com/geniova-tech/git-hooks).

## Combinación recomendada

| Capa | Esfuerzo | Eficacia |
|---|---|---|
| Backups (Borg) | Bajo | Alta — recuperación |
| Usuario restringido | Medio | **Muy alta** — prevención por kernel |
| `chattr +i` en claves SSH | Trivial | Alta para esos archivos |
| Branch protection | Trivial | Alta — server-side |
| Token sin `delete_repo` | Trivial | Alta |

## Objeciones habituales

**"Esto es demasiada fricción."** — Ejecuta la IA como `ia-user` solo cuando le delegues trabajo real. Para exploración y consultas, tu usuario normal está bien. La fricción es un `sudo -i -u ia-user` por sesión.

**"Mi IA es de confianza."** — Hoy quizás. La defensa no depende de la IA actual. Te protege ante futuras actualizaciones del modelo, prompt injection desde input no auditado, MCP servers que no has revisado, y tus propios dedazos a las 2 de la madrugada.

**"Yo uso Docker."** — Es una buena alternativa para la Capa 2. El principio es idéntico: aislamiento por kernel, no policing por denylist.

## Resumen

> No puedes prohibir lo que no has imaginado. Pero puedes negar acceso a lo que no debe tocarse.

Las capas fuertes (aislamiento por kernel + backups fiables) hacen el trabajo de verdad. Lo demás son ajustes finos. Esto aplica orquestes agentes con Karajan, ejecutes una IA suelta, o cualquier combinación — las defensas viven a nivel SO y de Git host, y por eso funcionan.

## Siguiente: los ficheros concretos para tu disco

Esta página es el *por qué*. Para el *cómo* — config concreta de git hooks, permisos de agentes (Claude / Codex / Gemini) y SSH multi-cuenta — mira [Configuración Recomendada](/es/guides/recommended-setup/).
