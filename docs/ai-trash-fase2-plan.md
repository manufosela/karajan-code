# ai-trash — Fase 2 plan (KJC-TSK-0387)

Plan de implementación apoyado en el informe Fase 1 (`docs/ai-trash-fase1-report.md`).

## Integración monorepo

Convertir `package.json` raíz en workspace (`"workspaces": ["packages/*"]`). Mantiene compat con `hu-board` y `pwgen`. Nuevo paquete `packages/ai-trash/` independiente: `name "@karajan/ai-trash"`, `private: false`, binario `kj-trash` publicable solo (sin acoplar a `src/`).

## Ficheros a crear

`packages/ai-trash/`:
- `package.json`, `README.md`, `CHANGELOG.md`.
- `bin/kj-trash` (shebang → `src/cli.js`).
- `src/cli.js`, `src/snapshotter/{files.js,git.js,sql.js,index.js}`, `src/manifest.js` (ULID + JSON-L), `src/trash-store.js` (paths, TTL 7d, cuota 10 GB LRU), `src/logger.js` (append-only), `src/permissions/{linux.js,macos.js}`.
- `templates/claude-pretool.sh`, `templates/settings.json.snippet`.
- `tests/{cli,snapshotter,manifest,trash-store,permissions}/*.test.js`, `tests/fixtures/` con repos git efímeros.

## Ficheros a modificar

- Raíz `package.json` (workspaces).
- `.github/workflows/release-binaries.yml` (matrix añade `kj-trash`).
- `docs/ai-trash-fase2-plan.md` (este).
- `CHANGELOG.md` (entry).

## Tests por capa

- **Unit** (vitest): `manifest` (ULID monotonic, parse/serialize), `trash-store` (TTL, LRU), `logger` (append-only), `snapshotter/files` (mv+reflink fallback cp).
- **Integration**: `snapshotter/git` con repos efímeros (`git bundle`, tags). `snapshotter/sql` con docker-compose ephemeral postgres.
- **CLI E2E**: `kj-trash list/inspect/restore` sobre trash poblada. `empty/purge` exigen TTY (mock).
- **Permissions** (lin/mac): smoke con sudo opcional, skip si no root.

## Publishing standalone

`npm publish --workspace @karajan/ai-trash` independiente de karajan-code. Binario SEA por release: `release-binaries.yml` añade target `kj-trash-{linux,darwin,win}`. Versión propia (semver, `v1.0.0`), tag `ai-trash-v*`.

## Orden de commits (≤200 LOC c/u)

1. `chore(monorepo): npm workspaces + packages/ai-trash skeleton`.
2. `feat(ai-trash): manifest + trash-store (ULID, TTL, cuota LRU)`.
3. `feat(ai-trash): logger append-only + permissions (linux+macos)`.
4. `feat(ai-trash): snapshotter files/dirs (mv + reflink)`.
5. `feat(ai-trash): cli list/inspect/restore + bin/kj-trash`.
6. `feat(ai-trash): cli empty/purge con TTY guard`.
7. `ci(ai-trash): release-binaries SEA targets`.

Snapshotters git/SQL y adapter Claude Code van en KJC-TSK-0389/0388/0390.

## Riesgos y validación

Riesgos del informe Fase 1 vigentes (reflinks, macOS ACL, hook Claude). Fase 3 abre con KJC-TSK-0388 (commits 1–6 arriba) una vez validado este plan.
