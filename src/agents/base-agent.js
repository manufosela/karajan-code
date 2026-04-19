/**
 * Base class for provider-specific agent adapters (claude, codex, gemini, ...).
 * Every concrete agent must implement runTask() and may override reviewTask().
 *
 * @typedef {import("../types/config.js").KarajanConfig} KarajanConfig
 * @typedef {import("../types/stage.js").Logger} Logger
 * @typedef {import("../types/agent.js").AgentResult} AgentResult
 */

const MODEL_NOT_SUPPORTED_PATTERNS = [
  /model.{0,30}is not supported/i,
  /model.{0,30}not available/i,
  /model.{0,30}does not exist/i,
  /unsupported model/i,
  /invalid model/i,
  /model_not_found/i
];

export class BaseAgent {
  /**
   * @param {string} name                    - agent slug (claude|codex|gemini|aider|opencode)
   * @param {KarajanConfig} config
   * @param {Logger} logger
   */
  constructor(name, config, logger) {
    this.name = name;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Execute a coding/agentic task. Subclasses MUST override.
   * @param {string|Object} _task
   * @returns {Promise<AgentResult>}
   */
  async runTask(_task) {
    throw new Error("runTask not implemented");
  }

  /**
   * Execute a review task. Subclasses MAY override for different behaviour.
   * @param {string|Object} _task
   * @returns {Promise<AgentResult>}
   */
  async reviewTask(_task) {
    throw new Error("reviewTask not implemented");
  }

  /**
   * @param {string} role
   * @returns {string|null}
   */
  getRoleModel(role) {
    const roleModel = this.config?.roles?.[role]?.model;
    if (roleModel) return roleModel;
    if (role === "reviewer") return this.config?.reviewer_options?.model || null;
    return this.config?.coder_options?.model || null;
  }

  /**
   * @param {string} role
   * @returns {boolean}
   */
  isAutoApproveEnabled(role) {
    if (role === "reviewer") return false;
    return Boolean(this.config?.coder_options?.auto_approve);
  }

  /**
   * Heuristic: does the agent's error look like "model not supported"?
   * Used by the retry/fallback path.
   * @param {Partial<AgentResult>} result
   * @returns {boolean}
   */
  isModelNotSupportedError(result) {
    const text = [result?.error, result?.output, result?.stderr, result?.stdout]
      .filter(Boolean).join("\n");
    return MODEL_NOT_SUPPORTED_PATTERNS.some(re => re.test(text));
  }
}
