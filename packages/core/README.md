# @karajan/core

Shared modules for the Karajan Code CLI and `@karajan/hu-board`. Private
workspace package — not published to npm.

## Scope

`@karajan/core` is the extraction destination for code that both the CLI
package (`karajan-code`) and the HU Board package (`@karajan/hu-board`)
need. Today it ships the atomic JSON writer; subsequent commits of
KJC-TSK-0511 will land the shared paths, port-check, run-registry,
process runner, plan validation, vector store, and plan/HU ops modules
here.

## Exports

| Subpath | Module |
| --- | --- |
| `@karajan/core/atomic-write` | `writeJsonAtomic`, `writeJsonAtomicSync` |
| `@karajan/core/shared-paths` | `SHARED_DIR_NAME`, `getSharedRoot`, `getSharedPlansDir`, `getSharedHuStoriesDir`, `isSharedPath` |
| `@karajan/core/port-check` | `isPortAvailable`, `findAvailablePort` |

The root export (`@karajan/core`) re-exports everything via the barrel
in `src/index.js`, but prefer the subpath form so the bundler can
tree-shake unused modules.

## Status

KJC-TSK-0511 PR1 — skeleton + first extraction (`atomic-write`). See the
task card for the full roadmap.
