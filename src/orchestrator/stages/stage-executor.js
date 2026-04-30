/**
 * StageExecutor — contract for per-stage orchestration logic (KJC-TSK-0315).
 *
 * The current orchestrator branches on a flat `pipelineFlags` object inside a
 * monolithic `runFlow`. This contract is the first step toward replacing those
 * branches with self-describing stage objects: each stage declares whether it
 * wants to run (`canRun`), how to run (`execute`), and what to do on failure
 * (`onFailure`). The orchestrator iterates a registry of stages instead of
 * owning knowledge of every pipeline flag.
 *
 * Scope for this PR: define the contract + a tiny registry. Existing stage
 * functions (e.g. src/orchestrator/stages/triage-stage.js) continue to be
 * called directly by flow-runner.js; future refactors can migrate them to
 * StageExecutor class form incrementally without touching the orchestrator.
 *
 * @typedef {Object} StageContext
 * @property {Object} config
 * @property {Object} session
 * @property {Object} logger
 * @property {Object} emitter
 * @property {Object} eventBase
 * @property {Object} pipelineFlags
 * @property {Object} stageResults
 * @property {Function} [trackBudget]
 * @property {Function} [askQuestion]
 * @property {Object} [brainCtx]
 * @property {number} [iteration]
 *
 * @typedef {Object} StageOutcome
 * @property {string} status - "ok" | "skipped" | "failed"
 * @property {*} [result]
 * @property {string} [detail]
 */

export class StageExecutor {
  /**
   * @param {string} name - unique stage slug (e.g. "triage", "reviewer")
   */
  constructor(name) {
    if (!name || typeof name !== "string") {
      throw new Error("StageExecutor requires a non-empty name");
    }
    this.name = name;
  }

  /**
   * Decide whether this stage should run for the current context. Default is
   * true; subclasses override to gate on pipelineFlags or task type.
   * @param {StageContext} _ctx
   * @returns {boolean | Promise<boolean>}
   */
  canRun(_ctx) {
    return true;
  }

  /**
   * Run the stage. MUST be overridden. Return a StageOutcome describing what
   * happened; the runner persists `result` under ctx.stageResults[this.name].
   * @param {StageContext} _ctx
   * @returns {Promise<StageOutcome>}
   */
  async execute(_ctx) {
    throw new Error(`StageExecutor(${this.name}).execute() not implemented`);
  }

  /**
   * Error hook. Default behaviour rethrows so the orchestrator's global
   * failure handling kicks in; subclasses can override to recover silently,
   * return a partial result, or escalate to Solomon before rethrowing.
   * @param {Error} err
   * @param {StageContext} _ctx
   * @returns {Promise<StageOutcome | void>}
   */
   
  async onFailure(err, _ctx) {
    throw err;
  }
}

/**
 * Registry of StageExecutor instances keyed by stage name. Kept intentionally
 * small — the orchestrator iterates `list()` in declared order and invokes
 * `canRun` / `execute` / `onFailure` as needed.
 */
export class StageRegistry {
  constructor() {
    /** @type {Map<string, StageExecutor>} */
    this._stages = new Map();
  }

  /**
   * @param {StageExecutor} stage
   */
  register(stage) {
    if (!(stage instanceof StageExecutor)) {
      throw new Error("StageRegistry.register(): argument must be a StageExecutor");
    }
    if (this._stages.has(stage.name)) {
      throw new Error(`StageRegistry: stage "${stage.name}" already registered`);
    }
    this._stages.set(stage.name, stage);
    return this;
  }

  /**
   * @param {string} name
   * @returns {StageExecutor | undefined}
   */
  get(name) {
    return this._stages.get(name);
  }

  /**
   * @returns {StageExecutor[]}
   */
  list() {
    return [...this._stages.values()];
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._stages.has(name);
  }

  get size() {
    return this._stages.size;
  }
}

/**
 * Run a stage via the contract. Centralizes the canRun/execute/onFailure
 * dance so future call sites don't reinvent it. Returns null when `canRun`
 * returns false (stage skipped).
 *
 * @param {StageExecutor} stage
 * @param {StageContext} ctx
 * @returns {Promise<StageOutcome | null>}
 */
export async function runStage(stage, ctx) {
  if (!(stage instanceof StageExecutor)) {
    throw new Error("runStage(): first argument must be a StageExecutor");
  }
  const shouldRun = await stage.canRun(ctx);
  if (!shouldRun) return null;
  try {
    return await stage.execute(ctx);
  } catch (err) {
    const recovered = await stage.onFailure(err, ctx);
    if (recovered !== undefined) return recovered;
    throw err;
  }
}
