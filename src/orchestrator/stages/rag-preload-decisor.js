// KJC-TSK-0434 — RAG Camino D: Brain decisor heuristic for retrieval.
// Decides WHETHER to pay the cost of running the RAG preload stage based
// on signals from triage + task shape, instead of pre-fetching every run.
//
// Returns `{ pull: boolean, reason: string }`. The pre-loop driver
// skips `runRagContextStage` when `pull === false`.
//
// Policies (config.rag.preload.policy):
//   - "always"  : pull regardless (back-compat with v2.24.0 behaviour)
//   - "never"   : never pull (useful for benchmarking, debugging)
//   - "auto"    : heuristic — pull only when triage signals complexity,
//                 decomposition, or when the task body is long enough
//                 to suggest non-trivial scope. Default.

const DEFAULT_POLICY = "auto";
const COMPLEX_LEVELS = new Set(["complex", "high", "epic"]);
const LONG_TASK_CHARS = 200;

/**
 * @param {object} params
 * @param {object} [params.triage]   - triage stage result (may be null)
 * @param {string} [params.task]     - the user task text
 * @param {object} [params.config]   - full karajan config
 * @returns {{ pull: boolean, reason: string }}
 */
export function shouldPreloadRag({ triage, task, config } = {}) {
  const policy = config?.rag?.preload?.policy || DEFAULT_POLICY;

  if (policy === "always") return { pull: true, reason: "policy:always" };
  if (policy === "never") return { pull: false, reason: "policy:never" };

  // policy === "auto" — apply heuristic.
  // Brownfield is an explicit user signal — if onboarding produced a
  // brief and config marks the project as brownfield, prior context is
  // almost always worth pulling.
  if (config?.rag?.preload?.brownfield === true) {
    return { pull: true, reason: "auto:brownfield" };
  }

  // Triage said this is big enough to decompose → multi-HU run benefits
  // from prior context fed to researcher/architect/planner.
  if (triage?.shouldDecompose === true) {
    return { pull: true, reason: "auto:decompose" };
  }

  // Triage classified the task as complex / high-effort.
  if (triage?.level && COMPLEX_LEVELS.has(String(triage.level).toLowerCase())) {
    return { pull: true, reason: "auto:complex" };
  }

  // Long task body usually means a brief with context, motivation and
  // non-trivial scope — worth checking the RAG.
  if (typeof task === "string" && task.length >= LONG_TASK_CHARS) {
    return { pull: true, reason: "auto:long-task" };
  }

  return { pull: false, reason: "auto:low-value" };
}
