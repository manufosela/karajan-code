---
title: Configuración Recomendada
description: Config concreta para git hooks, permisos de agentes, SSH multi-cuenta y branch protection — el complemento práctico de Blindar frente a IA.
---

Esta guía es el **complemento práctico** de [Blindar frente a IA](/es/guides/hardening-against-ai/). Esa guía explica *por qué* necesitas defensa en profundidad cuando delegas a IA; esta te da los *ficheros exactos para dejar en disco* y no tener que inventarte la config desde cero.

Todo es **agnóstico al agente**: SSH y git hooks son comunes, luego una sección por agente (Claude Code, Codex, Gemini CLI) con el equivalente de permisos. Coge los que uses de verdad y salta el resto.

> El final de cada sección tiene un bloque colapsable **"Setup real"** con la configuración de un mantenedor, ligeramente anonimizada. Útil como chequeo ("¿se me escapa algo obvio?") — no es dogma.

## 1. GitHub multi-cuenta vía SSH

Si commiteas desde más de una identidad (personal vs trabajo, o separas bot IA vs humano), no cambies `git config user.email` por repo. Usa una clave SSH por cuenta y un alias por cuenta en `~/.ssh/config`.

```sshconfig
# ~/.ssh/config

Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_personal
  IdentitiesOnly yes

Host github.com-personal
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_personal
  IdentitiesOnly yes

Host github.com-trabajo
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_trabajo
  IdentitiesOnly yes
```

Genera las claves con `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_<cuenta> -C "<email>"` y registra cada `.pub` en la cuenta de GitHub correspondiente.

Después clona con el alias:

```bash
git clone git@github.com-trabajo:org/repo.git
git clone git@github.com-personal:yo/proyecto-personal.git
```

`git push` usa automáticamente la clave correcta porque la URL del remote ancla el alias del host. Se acabó el "Permission denied (publickey)" cuando olvidas cambiar de cuenta.

<details>
<summary>Setup real</summary>

```sshconfig
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_personal

Host github.com-manufosela
  IdentityFile ~/.ssh/id_ed25519_personal

Host github.com-empresa
  IdentityFile ~/.ssh/id_ed25519
```

Dos claves separadas, un host por defecto (personal) más alias para ambas. Remotes antiguos del tipo `github.com-manufosela:...` siguen funcionando sin reescribir URLs.

</details>

## 2. Hooks de git globales con `core.hooksPath`

No instales hooks repo a repo. Apunta git a un directorio común y todos los repos de tu máquina heredan los mismos gates.

```bash
mkdir -p ~/.git-hooks
git config --global core.hooksPath ~/.git-hooks
```

### Hook `commit-msg`: bloquear atribución a IA

Pon esto en `~/.git-hooks/commit-msg`, dale `chmod +x`. Rechaza commits cuyo mensaje declare autoría IA — útil si tu política es "los humanos firman commits, la IA no":

```bash
#!/usr/bin/env bash
COMMIT_MSG=$(cat "$1")

CO_AUTHOR='Co-[Aa]uthored-[Bb]y:.*\b(Claude|Anthropic|OpenAI|ChatGPT|GPT-[0-9]|Copilot|Gemini|Cursor|Windsurf|Codeium)\b'
ATTRIBUTION='(Generated|Created|Written|Authored|Assisted) (by|with|using|via) .*(Claude|Anthropic|OpenAI|ChatGPT|Copilot|Gemini|Cursor|Windsurf|Codeium)'
SIGNED_OFF='Signed-off-by:.*\b(Claude|Anthropic|OpenAI|ChatGPT|Copilot|Gemini|Cursor|Windsurf|Codeium)\b'

for pat in "$CO_AUTHOR" "$ATTRIBUTION" "$SIGNED_OFF"; do
  if echo "$COMMIT_MSG" | grep -qiE "$pat"; then
    echo "✗ Commit rechazado: atribución a IA detectada." >&2
    echo "  Elimina la línea ofensiva y reintenta." >&2
    echo "  NO uses --no-verify; es un gate de política." >&2
    exit 1
  fi
done
```

### Hook `pre-commit`: chequeos de corrección baratos

Un pre-commit debe ser **rápido** (<2s) y **determinista**. Lint y formato del diff staged, no del árbol entero:

```bash
#!/usr/bin/env bash
STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|mjs|ts|tsx|jsx)$' || true)
[ -z "$STAGED" ] && exit 0

npx eslint --no-warn-ignored $STAGED || exit 1
```

Para gates por repo (test suite, build, shrink-budget), prefiere un workflow de CI — los pre-commit de 30 s pierden valor en cuanto la gente empieza a usar `--no-verify`.

### Hook `post-commit`: avisa, no bloquees

Útil para recordarte que pushees, lanzar un smoke check rápido o refrescar una caché local. Nunca metas lógica que pueda fallar — `post-commit` corre después de que el commit ya existe, no puede deshacerlo.

```bash
#!/usr/bin/env bash
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "⚠  Acabas de commitear en $BRANCH directamente. Mejor ramas + PRs." >&2
fi
```

<details>
<summary>Setup real</summary>

Un mantenedor mantiene **solo el `commit-msg`** globalmente y deja que la herramienta por proyecto (husky, lefthook, scripts del repo) gestione el pre-commit. Razón: pre-commit necesita contexto del proyecto (¿qué package manager? ¿qué config de lint?), pero la política anti-atribución IA es idéntica en todos los repos.

```bash
$ git config --global core.hooksPath
/home/me/.git-hooks
$ ls ~/.git-hooks
commit-msg
```

</details>

## 3. Branch protection del lado servidor

Los hooks locales son un aviso; la única capa enforceable está en el remote. Protege `main` con un ruleset de GitHub que bloquee force-push y deletion, y exija review en el PR.

Mira [Blindar frente a IA → Layer 4](/es/guides/hardening-against-ai/#layer-4--server-side-protection-on-git-hosts) para la receta completa con `gh api rulesets`. Lo mínimo para cualquier repo con delegación a IA:

- Bloquear force-push a `main`
- Bloquear deletion de `main`
- Exigir al menos una review (o status check) antes de merge
- Tu token de `gh` por defecto **no** lleva el scope `delete_repo`

Verifica los scopes:

```bash
gh auth status
# Token scopes: 'gist', 'read:org', 'repo', 'workflow'
# (sin delete_repo → bien)
```

## 4. Políticas de permisos por agente

Toda CLI de IA trae un fichero de permisos / sandbox. Mete el mismo set de patrones denylist en cada una para que un click descuidado no pase de un prompt de confirmación.

### 4a. Claude Code — `~/.claude/settings.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "defaultMode": "auto",
    "allow": [
      "Bash(npm run lint)",
      "Bash(npm run test *)",
      "Bash(npm run build)",
      "Bash(git log *)",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git fetch *)",
      "Bash(gh pr list *)",
      "Bash(gh pr view *)",
      "Bash(gh pr diff *)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Bash(rm -rf*)",
      "Bash(rm -fr*)",
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git push --delete*)",
      "Bash(git reset --hard*)",
      "Bash(git branch -D*)",
      "Bash(git clean -f*)",
      "Bash(git checkout --orphan*)",
      "Bash(gh repo delete*)",
      "Bash(gh release delete*)",
      "Bash(gh api -X DELETE*)",
      "Bash(gh api --method DELETE*)"
    ]
  }
}
```

`allow` cortocircuita el prompt de confirmación para lecturas y comandos rutinarios. `deny` rechaza por las bravas — Claude no puede saltárselo aunque el usuario diga que sí en la sesión.

### 4b. Codex — `~/.codex/rules/default.rules`

Codex usa un fichero plano de reglas con `prefix_rule(pattern=[...], decision="allow|deny")`. Pin los patrones destructivos a `deny`:

```python
prefix_rule(pattern=["rm", "-rf"], decision="deny")
prefix_rule(pattern=["git", "push", "--force"], decision="deny")
prefix_rule(pattern=["git", "push", "-f"], decision="deny")
prefix_rule(pattern=["git", "reset", "--hard"], decision="deny")
prefix_rule(pattern=["gh", "repo", "delete"], decision="deny")

prefix_rule(pattern=["npm", "test"], decision="allow")
prefix_rule(pattern=["npx", "vitest", "run"], decision="allow")
prefix_rule(pattern=["git", "log"], decision="allow")
prefix_rule(pattern=["git", "status"], decision="allow")
prefix_rule(pattern=["gh", "pr", "view"], decision="allow")
```

En `~/.codex/config.toml`, pin directorios sensibles a `trust_level = "untrusted"` para que Codex pregunte antes de tocarlos:

```toml
[projects."/home/me/secretos"]
trust_level = "untrusted"
```

### 4c. Gemini CLI — `~/.gemini/settings.json`

```json
{
  "security": {
    "auth": { "selectedType": "oauth-personal" }
  },
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

Acompáñalo con `~/.gemini/trustedFolders.json` para opt-in explícito de carpetas — todo lo que esté fuera dispara confirmación:

```json
{
  "trustedFolders": [
    "/home/me/proyectos/trabajo-actual"
  ]
}
```

Gemini CLI no expone un denylist tan rico como el de Claude, así que esta capa se apoya en **confianza por filesystem** más que en patrones de comando. Combínalo con el usuario restringido (sección siguiente) para seguridad real.

## 5. Usuario Linux restringido

La capa más fuerte la enforce el kernel: ejecuta los agentes IA como un `ia-user` dedicado con ACLs de solo-lectura por defecto y writes por proyecto solo cuando delegas activamente.

Mira [Blindar frente a IA → Layer 2](/es/guides/hardening-against-ai/#layer-2--prevention-a-separate-restricted-linux-user) para la receta completa. El TL;DR:

```bash
sudo useradd -m -s /bin/bash ia-user
setfacl -m u:ia-user:--x /home/$USER
setfacl -R -m u:ia-user:r-X /home/$USER/projects

# Conceder write solo mientras trabajas
setfacl -R -m u:ia-user:rwX ~/projects/actual

# Lanzar cualquier CLI de IA como el usuario restringido
sudo -i -u ia-user
claude   # o codex, gemini, aider — mismo UID, mismas restricciones
```

Un usuario restringido sirve para todas las CLIs de IA. El kernel devuelve `EACCES` antes de que el agente pueda intentar la operación, por creativos que sean sus comandos.

## 6. Flujo de trabajo diario

El objetivo de todo esto es un flujo que sobreviva a los errores:

1. **Una rama por tarea.** `git checkout -b feat/TICKET-N-descripcion-corta`. Nunca commitees en `main` — el post-commit de §2 te avisa si se te escapa.
2. **Commits pequeños.** Los hooks lintean el diff staged; commits pequeños mantienen el gate rápido.
3. **Push y PR.** `git push -u origin <rama>` y luego `gh pr create`. El ruleset del remote (§3) rechaza cualquier push directo a `main`.
4. **Auto-review antes que human-review.** Si usas el plugin `code-review` de Claude Code (slash `/code-review`), lánzalo sobre el diff del PR antes de pedir review. Cazas defectos obvios en segundos.
5. **Squash-merge.** Mantén `main` lineal. Los status checks bloquean el botón de merge hasta que los tests pasen.

Si delegas cualquiera de los pasos 1-4 a una IA, hazlo como `ia-user` (§5). El flujo branch-y-PR confina los errores a una rama desechable.

## 7. Escaneo de secretos antes del push

El hook `commit-msg` de §2 bloquea atribución a IA; el hook `pre-push` bloquea algo más peligroso — pushear credenciales a un remote que no controlas. Una vez que los secretos están en GitHub, rotarlos es la única respuesta segura. Pre-push es tu última oportunidad de cazarlos en local.

### git-secrets (basado en patrones)

[`git-secrets`](https://github.com/awslabs/git-secrets) trae patrones de AWS por defecto y acepta regexes custom. Instálalo una vez y engánchalo al directorio global de hooks:

```bash
# Build + install (una sola vez)
git clone https://github.com/awslabs/git-secrets.git /tmp/git-secrets
sudo make -C /tmp/git-secrets install

# Registrar patrones de AWS + instalar hooks globalmente
git secrets --register-aws --global
git secrets --install --global ~/.git-hooks

# Patrones custom: tokens de GitHub, claves de GCP, API keys genéricas
git secrets --add --global 'ghp_[A-Za-z0-9]{36}'
git secrets --add --global 'AIza[0-9A-Za-z\-_]{35}'
git secrets --add --global '(?i)(api[_-]?key|secret)[ \t=:"]+[A-Za-z0-9+/=_-]{20,}'
```

La herramienta instala tres handlers: `pre-commit`, `commit-msg` y `prepare-commit-msg`. Un match devuelve exit 1 con el fichero + línea para que arregles y reintentes. Permitir un falso positivo: `git secrets --add --allowed --global '<match exacto>'`.

### `pre-push`: bloquear push directo a ramas protegidas

La branch protection del servidor (§3) ya rechaza estos pushes, pero un hook `pre-push` local para la petición antes de salir de la máquina. Te ahorra minutos de CI y evita el incómodo "lo intenté, el remote lo rechazó":

```bash
#!/usr/bin/env bash
# ~/.git-hooks/pre-push
PROTECTED='^refs/heads/(main|master|production|release/.*)$'

while read local_ref local_sha remote_ref remote_sha; do
  if [[ "$remote_ref" =~ $PROTECTED ]]; then
    echo "✗ Push directo a $remote_ref rechazado. Abre un PR." >&2
    echo "  Override: git push --no-verify  (no lo hagas)." >&2
    exit 1
  fi
done
exit 0
```

`git-secrets` NO instala un hook `pre-push` por defecto, así que los dos conviven sin conflicto. Si llegas a necesitar combinar varios chequeos `pre-push`, encadénalos con un wrapper que salga al primer non-zero.

<details>
<summary>Setup real</summary>

Un mantenedor mantiene solo el `pre-push` con branch-check globalmente y deja `git-secrets` por repo (vía `npm run secrets:scan` en CI). Razón: las listas de patrones drift por proyecto (un repo de fintech tiene shapes distintas que un sitio estático), y los patrones globales acaban siendo demasiado ruidosos o demasiado laxos.

</details>

## 8. Plantillas de repo en GitHub

Un PR sin descripción es un code review a ciegas. Las plantillas hacen que la colaboración sea honesta por defecto.

### Plantilla de PR

Pon esto en `.github/PULL_REQUEST_TEMPLATE.md` en la raíz de cada repo:

```markdown
## Summary

<!-- Una o dos frases: qué cambia y por qué. -->

## Test plan

- [ ] Los tests existentes pasan
- [ ] Tests nuevos para el cambio
- [ ] Probado manualmente en <navegador/OS/versión>
- [ ] Sin atribución a IA en commits ni PR body

## Checklist

- [ ] PR atómica (una sola feature, fix o refactor)
- [ ] Bajo ~200 LOC netas (o label `large-pr-justified` con justificación)
- [ ] Ticket enlazado: <!-- ej. PRJ-TSK-0042 -->
```

Si tu equipo usa el plugin `code-review` de Karajan Code, esta checklist es lo que evalúa — mantenlas alineadas.

### Plantillas de issue (form schema YAML)

Los campos estructurados fuerzan bug reports usables. `.github/ISSUE_TEMPLATE/bug.yml`:

```yaml
name: Bug report
description: Algo roto, con un repro limpio
labels: [bug]
body:
  - type: textarea
    id: repro
    attributes:
      label: Pasos para reproducir
      placeholder: |
        1. Ejecuta `...`
        2. Clica en `...`
        3. Observa `...`
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Comportamiento esperado
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Versión
      placeholder: "2.13.0"
    validations:
      required: true
```

Las flags `required: true` rechazan el "no funciona" en blanco. Añade un `feature.yml` con campos `idea` / `acceptance criteria` si tu equipo usa GitHub Issues para planificar.

## 9. CODEOWNERS

`.github/CODEOWNERS` enruta las review requests por fichero/directorio. Combinado con la regla de branch protection **Require review from Code Owners** (configurada en tu ruleset de §3), las reviews en rutas críticas no se pueden saltar:

```
# Por defecto — todo al mantenedor
*  @maintainer-handle

# Infra crítica — el equipo de seguridad firma
/.github/workflows/   @maintainer-handle  @security-team
/infra/               @ops-team
/src/auth/            @maintainer-handle  @security-team

# Pipeline de build/release — solo el release manager
/.github/workflows/release-*.yml  @release-manager
package.json                       @release-manager

# Docs — auto-aprobación está bien
/docs/  @maintainer-handle
```

El matching es **last-rule-wins** y soporta globs estilo gitignore. Verifica el routing tras pushear:

```bash
gh api repos/OWNER/REPO/codeowners/errors
# {"errors": []}  → todos los paths resuelven a un owner conocido
```

Un array `errors` no vacío significa que al menos una línea del CODEOWNERS apunta a un usuario/equipo que no existe o no tiene acceso al repo. Arréglalo antes de exigir review de code-owners server-side; si no, los PRs que toquen esos paths se vuelven no-mergeables.

## Combinando las capas

| Capa | Tiempo setup | Qué caza |
| ---- | ------------ | -------- |
| SSH multi-cuenta | 5 min | Commits con identidad equivocada |
| `commit-msg` global | 2 min | Atribución IA en mensajes |
| Denylist por agente | 5 min/agente | Comandos destructivos casuales |
| Ruleset branch protection | 2 min/repo | Force-push, borrado de ramas |
| `pre-push` + `git-secrets` | 10 min | Credenciales pusheadas por accidente |
| Plantillas de PR/Issue | 5 min/repo | PRs sin contexto, bug reports en blanco |
| `CODEOWNERS` + reviews requeridas | 5 min/repo | Rutas críticas mergeadas sin el reviewer correcto |
| `ia-user` + ACLs | 15 min | Lo que escape del denylist del agente |
| Backups Borg | 30 min | Lo que escape de todo lo demás |

No necesitas todas en el día uno. Empieza con SSH multi-cuenta + branch protection + el denylist del agente que uses; añade el usuario restringido y CODEOWNERS la primera vez que delegues algo no trivial en un repo que importe.

## Relacionado

- [Blindar frente a IA](/es/guides/hardening-against-ai/) — las capas conceptuales y por qué cada una importa.
- [Configuración](/es/guides/configuration/) — config específica de Karajan en `kj.config.yml`.
- [HU Board](/es/guides/hu-board/) — el dashboard que enseña qué están corriendo tus agentes.
