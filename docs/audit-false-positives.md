# Audit false positives — verified non-removable dependencies

> Living document. When a `kj audit` run flags a dependency as unused but
> manual verification confirms it IS used (typically via config files,
> hooks, or scripts not imported as JS modules), append an entry below.
> Doing this prevents future audits from re-opening the same investigation.

## Why this exists

`kj audit` (and the underlying `knip` heuristic) detects dependencies
that are not statically imported anywhere in the codebase. This catches
real dead weight, but produces false positives for tools that integrate
through indirect means:

- **Build/test config files** referenced by name (e.g. a Vitest
  `provider: "v8"` referencing `@vitest/coverage-v8`).
- **Git hooks** installed once into `.git/hooks/` by the package itself
  (e.g. `simple-git-hooks`).
- **Scripts on disk** invoked via `npx` from shell scripts or CI
  workflows (e.g. `postject` invoked by `scripts/build-sea.mjs`).
- **External infrastructure** with config in dot-folders (e.g.
  `@changesets/cli` driven by `.changeset/config.json`).

If you remove one of these, the corresponding workflow breaks even
though no JS test fails. Hence: verify before removing.

## Verified false positives (2026-05-04)

Audit run: `kj audit` on 2026-05-03 (PR #577 / KJC-TSK-0352 epoch).
Investigation tracked in KJC-TSK-0353 / GH issue #574.

| Dependency | Verdict | Evidence |
| --- | --- | --- |
| `@changesets/cli` | **Keep** | `.changeset/config.json` references `@changesets/cli/changelog`. PR #360 (Jorge del Casar) is in flight against changesets infra. |
| `@vitest/coverage-v8` | **Keep** | `vitest.config.js` declares `coverage.provider = "v8"`. Activated when running `npx vitest run --coverage`. |
| `postject` | **Keep** | `scripts/build-sea.mjs` invokes `npx postject` to inject the SEA blob into the binary. Workflow `release-binaries.yml` depends on this for every release. |
| `simple-git-hooks` | **Keep** | Hook installed at `.git/hooks/pre-commit` (runs `npx lint-staged`). Config block in `package.json` under `"simple-git-hooks"`. |

## Process for future audits

1. Run `kj audit` and read the `unusedDependencies.unused` list.
2. For each candidate, before opening a removal PR, grep the entire
   repo: `grep -rn "<dep-name>" package.json scripts/ .github/ docs/`.
3. If any indirect usage is found, append an entry to the table above
   instead of removing the dependency.
4. Only `npm uninstall` after all four verification paths come back
   empty (JS imports, config files, scripts, hooks).
