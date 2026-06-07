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
| `@karajan/core/paths` | `resolveHome`, `getKarajanHome`, `getSessionRoot`, `getSonarComposePath`, `getOllamaComposePath`, `getWebperfDir`, `getRunsDir`, `getPromptsDir`, `__resetKjHomeWarningForTests` |
| `@karajan/core/run-registry` | `runsDir`, `registerRun`, `unregisterRun`, `listActiveRuns` |
| `@karajan/core/vec-store` | `dbPath`, `openVecStore`, `insertChunk`, `searchSimilar`, `searchBM25`, `projectSlug`, `deleteChunksBySource`, `findChunkByHash`, `getEmbeddingsByIds`, `getLastIndexedCommit`, `setLastIndexedCommit`, `countChunks` |
| `@karajan/core/plan-id` | `generatePlanId`, `generateHuId`, `normaliseAlias` |
| `@karajan/core/plan-hu-ops` | `addHu`, `removeHu`, `updateHu`, `updateHuStatus`, `setHuOutcome`, `setPlanOutcome`, `autoCertifyPendingHus`, `assertPlanRunnable`, `computePlanOutcome`, `certifyAllHus`, `reorderHus` |
| `@karajan/core/plan-validation` | `validateBlockedByChange` |
| `@karajan/core/process` | `runCommand` (execa wrapper with output streaming, silence/total timeouts, ENOENT enrichment) |

The root export (`@karajan/core`) re-exports everything via the barrel
in `src/index.js`, but prefer the subpath form so the bundler can
tree-shake unused modules.

## Status

KJC-TSK-0511 PR6 — `plan-validation` + `process` extracted. With this
PR `@karajan/hu-board` no longer reaches into `../../../src` from any
static import (dynamic `await import(...)` from `brain/`, `rag/`, and
`git/hu-snapshot` remain pending for a follow-up).
