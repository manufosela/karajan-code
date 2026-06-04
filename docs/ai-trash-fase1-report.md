# ai-trash — Fase 1 (KJC-TSK-0386)

## Stack
Node 22 ESM compilado a **Single Executable App** (`node --experimental-sea-config`). Reutiliza `release-binaries.yml`.

## Paquete plantilla
Ninguno encaja al 100 %. `packages/hu-board/` aporta convenciones (vitest, scripts, Dockerfile). Estructura propia: `packages/ai-trash/{src/{cli,snapshotter,manifest,trash-store,logger}.js, templates/claude-pretool.sh, bin/kj-trash}`.

## Decisiones críticas

1. **Standalone vs core.** Paquete dentro del monorepo (`packages/ai-trash/`) publicable como binario independiente (`kj-trash`). Sin acoplamiento a `src/`. Cubrir Codex/Gemini/Aider/OpenCode NO obliga a tocar core: cada agente expone su adapter (post-MVP, KJC-TSK-0392). El standalone se preserva.
2. **Hook PreToolUse (Claude Code) MVP**, wrapper genérico post-MVP. MVP intercepta `Bash`/`Write`/`Edit`; los demás vía adapter por agente o wrapper de proceso.
3. **3 snapshotters MVP** (ficheros/dirs vía `mv` + reflink cuando exista; git vía `git bundle` + tag local; SQL vía `pg_dump`/`mysqldump` por detección URL/socket). SQL puede ser thin pero entra en MVP según prompt.
4. **Papelera inalcanzable.** Linux: raíz `chown root:kj-trash` + `chattr +a` sobre log. macOS: ACL `deny delete` + perms 0700 root. Windows fuera de MVP. Sin setuid; escalada por servicio local opcional.

## Puntos abiertos resueltos
- **IDs**: ULID (orden cronológico, monotónico).
- **TTL**: 7 días por defecto, configurable. Cuota 10 GB con purga LRU.
- **Cifrado at-rest**: roadmap (post-MVP).
- **CLI**: `kj-trash {list,inspect,restore}`; `{empty,purge}` exigen TTY humano + confirmación.

## Fases siguientes
- **Fase 2** (KJC-TSK-0387): plan detallado, orden de commits, contrato de tests.
- **Fase 3**: KJC-TSK-0388 MVP files/dirs · 0389 git · 0390 adapter Claude Code · 0391 `kj doctor` · 0392 wrapper genérico.

## Riesgos
- `rm -rf node_modules` sin reflinks en ext4 antiguo: lento.
- macOS sin `chattr`: mitigación ACL + root-owned.
- Hook PreToolUse puede no recibir todos los args destructivos: validar con corpus real.

## Solapamiento con KJC-TSK-0384 (onboarder)
Independientes. Posible helper `git-info.js` compartido si surge duplicación.
