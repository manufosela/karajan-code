/**
 * Per-run context store — makes module-level state in `utils/git.js`,
 * `review/diff-generator.js`, etc. safe under concurrent `runFlow` calls.
 *
 * Pre-v2.7.5 the orchestrator mutated module-scope variables at pipeline
 * start:
 *   setDiffRunner(rtkRunner); setDiffProjectDir(diffScope);
 *   setGitRunner(rtkRunner);
 *   // …later…
 *   // every git/diff op reads those globals
 *
 * That is fine for a single-threaded CLI invocation but corrupts when the
 * MCP server fields two `kj_run` tool calls in parallel: each run would
 * overwrite the others' runner/projectDir during setup, and subsequent
 * reads would see a mix.
 *
 * TSK-0338 isolates that state to a per-run AsyncLocalStorage scope.
 * `runFlow` wraps its execution in `withRunContext(ctx, fn)`, and the
 * read paths in git.js / diff-generator.js look up
 * `getRunContext()?.runner` before falling back to the module-level
 * `_runner` (kept as a back-compat entry for callers outside a
 * `runFlow` — CLI helpers, tests — that set state directly).
 *
 * What lives here vs. elsewhere:
 *   - `runContext` (this module) — runner, projectDir, snapshot — the
 *     pieces git/diff touches synchronously on every op.
 *   - `PipelineContext` (src/orchestrator/pipeline-context.js) — the
 *     richer structure ferried between stages. The two could merge
 *     eventually, but PipelineContext is created after preflight, and
 *     the runner/projectDir must be in scope BEFORE preflight runs
 *     (which itself calls git commands).
 *
 * The invariant `tests/orchestrator/concurrent-runs.test.js` exercises
 * the isolation: two parallel `withRunContext(A, …)` and
 * `withRunContext(B, …)` see their own runner, not each other's.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * @typedef {Object} RunContext
 * @property {((command: string, args?: string[], options?: object) => Promise<object>)|null} [runner]
 *   Pipeline-scoped command runner. When present, git.js + diff-generator.js
 *   route commands through it instead of the default `runCommand`.
 * @property {string|null} [projectDir]
 *   Directory scope for `git diff`. Prevents leaking unrelated subdir
 *   changes when `kj run` is invoked from a subpath of a monorepo.
 * @property {Map<string, string>|null} [snapshot]
 *   Pre-coder filesystem snapshot for snapshot-based diff when git is
 *   unavailable (greenfield projects with no initial commit).
 */

const runStore = new AsyncLocalStorage();

/**
 * Run `fn` with `ctx` as the active RunContext. All reads of
 * `getRunContext()` inside (including from awaited callees) see `ctx`.
 * Concurrent `withRunContext` invocations are fully isolated from each
 * other — that's what AsyncLocalStorage guarantees.
 *
 * @param {RunContext} ctx
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export function withRunContext(ctx, fn) {
  return runStore.run(ctx ?? {}, fn);
}

/**
 * @returns {RunContext|undefined} the active RunContext, or undefined when
 *   called outside any `withRunContext` scope (legacy CLI paths, tests).
 */
export function getRunContext() {
  return runStore.getStore();
}
